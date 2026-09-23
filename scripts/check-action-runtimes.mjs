/**
 * scripts/check-action-runtimes.mjs — fail when a workflow pins an action that runs on a
 * Node runtime GitHub has moved past.
 *
 * Every `uses:` in .github/workflows/ was on a Node 20 action when GitHub announced the
 * deprecation, and the fix was a coordinated bump of eight actions. Nothing stopped that
 * from reappearing one action at a time: `uses: actions/checkout@v4` looks exactly like
 * `@v7` in review, and the only signal was a warning annotation nobody fails on.
 *
 * The runtime is not something this repo can know from the pin alone — it lives in each
 * action's own `action.yml` (`runs.using`). So this reads that file, at the *pinned ref*,
 * which means a tag that gets republished onto an old runtime is caught too. There is no
 * hardcoded action→runtime table to go stale, apart from the single number below.
 *
 * Composite actions have no runtime of their own; they wrap other actions, so their inner
 * `uses:` are followed (bounded, cycle-safe) — a stale Node action hidden inside
 * `upload-pages-artifact` is still a stale Node action.
 *
 *   node scripts/check-action-runtimes.mjs [--workflows <dir|file>]… [--json]
 *
 * Reads .github/workflows/ by default. Filenames ending in .yml/.yaml and `docker://`
 * refs are skipped (a reusable workflow declares no runtime). Exits non-zero, with
 * `::error::` annotations, when any pinned action is behind `CURRENT_NODE` — and also
 * when a runtime cannot be determined at all, because a check that quietly passes when
 * it could not verify anything is worse than no check.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The Node major GitHub currently runs Actions on. Bump this when they move — it is the
 * one hardcoded fact here, and everything else is read from the actions themselves.
 * Anything older fails, anything newer is reported as "ahead of this script".
 */
export const CURRENT_NODE = 24;

/** How deep to follow composite actions before giving up on understanding the chain. */
export const MAX_DEPTH = 3;

const RAW = 'https://raw.githubusercontent.com';
const API = 'https://api.github.com';

// ── Pure helpers (unit-tested in tests/action-runtimes.test.mjs) ─────────────

/**
 * Pull every `uses:` out of workflow or action YAML.
 *
 * Deliberately a line scan rather than a YAML parse: this repo has no runtime
 * dependencies, and `uses:` only ever appears as a step key. Trailing comments are
 * dropped so `uses: foo@v1 # bump me` does not mangle the spec.
 */
export function parseUses(text) {
  const found = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const match = /^\s*(?:-\s*)?uses:\s*(.+?)\s*$/.exec(line);
    if (!match) return;
    const spec = match[1].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim();
    if (spec) found.push({ line: i + 1, spec });
  });
  return found;
}

/**
 * Split `owner/repo/sub/path@ref` into its parts.
 *
 * Returns `{ kind: 'local' }` for `./path`, `{ kind: 'docker' }` for `docker://…`,
 * `{ kind: 'workflow' }` for a reusable workflow (a `.yml`/`.yaml` target, which
 * declares no runtime) and `{ kind: 'action' }` otherwise. Anything that does not look
 * like any of those is `{ kind: 'invalid' }` so it is reported rather than ignored.
 */
export function splitSpec(spec) {
  const trimmed = String(spec).trim();
  if (/^docker:\/\//.test(trimmed)) return { kind: 'docker', spec: trimmed };
  if (/^\.{1,2}\//.test(trimmed)) return { kind: 'local', spec: trimmed };
  if (/^https?:\/\//.test(trimmed)) return { kind: 'invalid', spec: trimmed, reason: 'a URL, not a repo reference' };
  if (!trimmed.includes('/') || !trimmed.includes('@')) {
    return { kind: 'invalid', spec: trimmed, reason: 'expected owner/repo[/path]@ref' };
  }

  const at = trimmed.lastIndexOf('@');
  const body = trimmed.slice(0, at);
  const ref = trimmed.slice(at + 1);
  const [owner, repo, ...rest] = body.split('/');
  if (!owner || !repo || !ref) return { kind: 'invalid', spec: trimmed, reason: 'expected owner/repo[/path]@ref' };

  // A reusable workflow (`owner/repo/.github/workflows/x.yml@ref`) declares no runtime of
  // its own, so it is skipped rather than fetched as an action — checked against the whole
  // path, since a trailing slash would otherwise hide the extension.
  if (/\.ya?ml$/i.test(rest.join('/'))) return { kind: 'workflow', spec: trimmed, owner, repo, ref };

  const subpath = rest.length ? rest.join('/') + '/' : '';
  return { kind: 'action', spec: trimmed, owner, repo, ref, subpath };
}

/** Where the manifest for a remote action lives, for a given filename. */
export function manifestUrls({ owner, repo, ref, subpath }) {
  const base = subpath || '';
  return [`${RAW}/${owner}/${repo}/${ref}/${base}action.yml`, `${RAW}/${owner}/${repo}/${ref}/${base}action.yaml`];
}

/**
 * GitHub's `runs.using`, read from an action manifest.
 *
 * `node20` → 20, so the comparison is numeric rather than a list of strings that someone
 * has to remember to extend. Composite and Docker actions return null: neither declares
 * a Node runtime of its own.
 */
export function parseNodeRuntime(text) {
  const using = /^\s*using:\s*["']?([\w.-]+)["']?\s*$/m.exec(text)?.[1];
  if (!using) return { using: null, major: null };
  const node = /^node(\d+)$/.exec(using.toLowerCase());
  return { using, major: node ? Number(node[1]) : null };
}

/** The verdict for one `runs.using` value. */
export function classifyRuntime(using) {
  if (!using) return { status: 'unknown', reason: 'no `runs.using` in the action manifest' };
  const lower = using.toLowerCase();
  if (lower === 'composite') return { status: 'composite', reason: 'composite action — its inner uses are followed' };
  if (lower === 'docker') return { status: 'docker', reason: 'Docker action — no Node runtime' };

  const node = /^node(\d+)$/.exec(lower);
  if (!node) return { status: 'unrecognised', reason: `unrecognised \`runs.using: ${using}\`` };
  const major = Number(node[1]);
  if (major < CURRENT_NODE) return { status: 'stale', major, reason: `runs on Node ${major}; Actions now use Node ${CURRENT_NODE}` };
  if (major === CURRENT_NODE) return { status: 'current', major };
  return { status: 'ahead', major, reason: `runs on Node ${major}, newer than CURRENT_NODE ${CURRENT_NODE} — bump the constant` };
}

/**
 * Which verdicts fail the check. Everything that is not provably fine has to be here:
 * the point of the guard is that nothing passes by being unrecognised, and `unknown` in
 * particular means the manifest was read but declared no runtime at all.
 */
export const FAILING_STATUSES = ['stale', 'unrecognised', 'unknown', 'unreadable', 'invalid'];

/** Verdicts that carry no runtime to judge — reported, never counted as failures. */
export const INFORMATIONAL_STATUSES = ['composite', 'docker', 'skipped'];

/** Verdicts that are a pass: current, or newer than this script knows about. */
export const PASSING_STATUSES = ['current', 'ahead'];

/** The mark shown for a verdict in the table. */
export const MARK_FOR = { current: '✔', ahead: '!', skipped: '○', docker: '✔', composite: '✔' };

export const markFor = status => FAILING_STATUSES.includes(status) ? '✖' : MARK_FOR[status] || '?';

// ── Reference discovery ─────────────────────────────────────────────────────

/** Workflow files to scan: an explicit path (file or dir) or .github/workflows/. */
export function workflowFiles(inputs = []) {
  const targets = inputs.length ? inputs : [path.join(ROOT, '.github/workflows')];
  const files = [];
  for (const target of targets) {
    const abs = path.resolve(ROOT, target);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isDirectory()) {
      for (const name of fs.readdirSync(abs).sort()) {
        if (/\.ya?ml$/i.test(name)) files.push(path.join(abs, name));
      }
    } else {
      files.push(abs);
    }
  }
  return files;
}

/** Every distinct action reference pinned across the given workflows. */
export function collectReferences(files) {
  const seen = new Map();
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const { spec, line } of parseUses(text)) {
      const parsed = splitSpec(spec);
      const key = parsed.kind === 'local' ? `local:${parsed.spec}` : spec;
      if (!seen.has(key)) seen.set(key, { ...parsed, spec, sites: [] });
      seen.get(key).sites.push(`${path.basename(file)}:${line}`);
    }
  }
  return [...seen.values()];
}

// ── Fetching ────────────────────────────────────────────────────────────────

/**
 * A fetch with a deadline, using a timer that is cleared (and never holds the process
 * open) rather than `AbortSignal.timeout`, whose pending timers crash the Node process on
 * Windows when the run terminates.
 */
async function timedFetch(fetchImpl, url, init = {}, ms = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`no response after ${ms}ms`)), ms);
  timer.unref?.();
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read an action manifest: raw.githubusercontent first (no rate limit, no token), then
 * the contents API — which also resolves anything raw cannot, and reports 404s clearly.
 */
export async function fetchManifest(spec, { fetchImpl = fetch, token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN } = {}) {
  const errors = [];
  for (const url of manifestUrls(spec)) {
    try {
      const res = await timedFetch(fetchImpl, url);
      if (res.ok) return { text: await res.text(), source: url };
      errors.push(`${url} → ${res.status}`);
    } catch (err) {
      errors.push(`${url} → ${err.message}`);
    }
  }

  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'signout-action-runtime-check' };
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const res = await timedFetch(fetchImpl, `${API}/repos/${spec.owner}/${spec.repo}/contents/${spec.subpath || ''}action.yml?ref=${spec.ref}`, { headers });
    if (res.ok) {
      const body = await res.json();
      if (body.encoding === 'base64') {
        return { text: Buffer.from(body.content, 'base64').toString('utf8'), source: `${spec.owner}/${spec.repo}@${spec.ref} (API)` };
      }
    }
    errors.push(`api ${res.status}`);
  } catch (err) {
    errors.push(`api ${err.message}`);
  }
  throw new Error(`could not read action.yml — ${errors.join('; ')}`);
}

// ── Evaluation ──────────────────────────────────────────────────────────────

/**
 * Inspect one reference and everything it wraps.
 *
 * Returns an array of records, one per action actually reached: the pinned action itself
 * when it has a runtime, plus any actions it delegates to. `manifest` is injectable so the
 * whole traversal can be tested without network access.
 */
export async function inspectReference(ref, { readManifest, depth = 0, seen = new Set() } = {}) {
  const key = ref.kind === 'local' ? `local:${ref.spec}` : ref.spec;
  if (seen.has(key)) return [];
  seen.add(key);

  if (ref.kind === 'invalid') {
    return [{ spec: ref.spec, sites: ref.sites, status: 'invalid', reason: ref.reason }];
  }
  if (ref.kind === 'docker') {
    return [{ spec: ref.spec, sites: ref.sites, status: 'docker', reason: 'Docker reference — no Node runtime' }];
  }
  // A reusable workflow declares no runtime of its own, and its inner actions belong to
  // whatever repo it lives in — fetching them could fail on permissions the caller does
  // not have, so this is reported rather than treated as a failure.
  if (ref.kind === 'workflow') {
    return [{ spec: ref.spec, sites: ref.sites, status: 'skipped', reason: 'reusable workflow — not inspected' }];
  }

  let text;
  let source;
  try {
    ({ text, source } = await readManifest(ref));
  } catch (err) {
    return [{ spec: ref.spec, sites: ref.sites, status: 'unreadable', reason: err.message }];
  }

  const { using } = parseNodeRuntime(text);
  const verdict = classifyRuntime(using);
  const record = { spec: ref.spec, sites: ref.sites, using, source, ...verdict };

  // A composite action has no runtime of its own — the risk is what it wraps.
  if (verdict.status !== 'composite') return [record];

  if (depth >= MAX_DEPTH) {
    return [{ ...record, reason: `composite action nested deeper than ${MAX_DEPTH} — not followed` }];
  }

  const inner = [];
  for (const { spec } of parseUses(text)) {
    const parsed = splitSpec(spec);
    if (parsed.kind === 'docker' || parsed.kind === 'workflow') continue;
    if (parsed.kind === 'local') continue; // resolved against the action's own repo, not ours
    if (parsed.kind === 'invalid') continue;
    inner.push(...await inspectReference({ ...parsed, sites: [`${ref.spec} → ${spec}`] },
      { readManifest, depth: depth + 1, seen }));
  }
  return [record, ...inner];
}

// ── CLI ─────────────────────────────────────────────────────────────────────

export async function main(argv = process.argv.slice(2), { fetchImpl = fetch } = {}) {
  const workflows = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--workflows') workflows.push(argv[++i]);
    else if (!argv[i].startsWith('--')) workflows.push(argv[i]);
  }
  const json = argv.includes('--json');

  const files = workflowFiles(workflows);
  if (!files.length) {
    console.log('::error::no workflow files found to check.');
    return 1;
  }

  const refs = collectReferences(files);
  const readManifest = ref => {
    if (ref.kind === 'local') {
      const abs = path.resolve(ROOT, ref.spec);
      const target = fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? path.join(abs, 'action.yml') : abs;
      if (!fs.existsSync(target)) throw new Error(`local action not found: ${ref.spec}`);
      return { text: fs.readFileSync(target, 'utf8'), source: ref.spec };
    }
    return fetchManifest(ref, { fetchImpl });
  };

  const records = [];
  for (const ref of refs) {
    records.push(...await inspectReference(ref, { readManifest }));
  }

  if (json) {
    console.log(JSON.stringify({ files: files.map(f => path.relative(ROOT, f)), records }, null, 2));
  } else {
    console.log(`Action runtimes — ${files.length} workflow file(s), ${refs.length} pinned reference(s)`);
    console.log(`Bar: Node ${CURRENT_NODE} (CURRENT_NODE in scripts/check-action-runtimes.mjs)\n`);
    for (const r of records) {
      const runtime = r.using ? `[${r.using}]` : `[${r.status}]`;
      console.log(`${markFor(r.status)} ${r.spec.padEnd(42)} ${runtime.padEnd(10)} ${r.reason || 'up to date'}`);
    }
  }

  const failures = records.filter(r => FAILING_STATUSES.includes(r.status));
  const ahead = records.filter(r => r.status === 'ahead');
  const skipped = records.filter(r => r.status === 'skipped');
  const movingTags = refs.filter(r => r.kind === 'action' && !/^[0-9a-f]{40}$/i.test(r.ref)).length;

  for (const f of failures) {
    const where = f.sites?.length ? ` (${f.sites.join(', ')})` : '';
    console.log(`::error::${f.spec}${where} — ${f.reason}`);
  }
  for (const a of ahead) console.log(`::warning::${a.spec} — ${a.reason}`);
  for (const s of skipped) console.log(`::notice::${s.spec} — ${s.reason}`);
  if (movingTags) {
    console.log(`::notice::${movingTags} reference(s) are pinned to a moving tag; the runtime above is re-read on every run, but a full commit SHA cannot be repointed.`);
  }

  if (failures.length) {
    console.log(`\n::error::${failures.length} action reference(s) cannot be verified as running on Node ${CURRENT_NODE} — bump them to a major whose action.yml declares it.`);
    return 1;
  }
  console.log(`\nAll ${records.length} action reference(s) run on a current Node runtime.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // The exit code is set and the process allowed to finish naturally: calling
  // `process.exit()` while a request is in flight trips a libuv assertion on Windows.
  main()
    .then(code => { process.exitCode = code; })
    .catch(err => {
      console.log(`::error::${err.message}`);
      process.exitCode = 1;
    });
}
