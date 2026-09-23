/**
 * tests/action-runtimes.test.mjs — the guard that keeps workflows off deprecated Node
 * runtimes.
 *
 * The check's whole value is the decision it makes about a `uses:` line, so that decision
 * is exercised here with an injected manifest reader: no network, and every verdict —
 * stale, current, ahead, composite, docker, unreadable, malformed — pinned down.
 *
 * It deliberately does *not* assert that today's pins are current: that needs the live
 * action.yml files, which is what the CI step does. What is asserted here is that the real
 * workflows all parse and that no reference is malformed or pinned to a branch, since a
 * reference this scanner cannot read is a reference it silently cannot guard.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CURRENT_NODE,
  FAILING_STATUSES,
  INFORMATIONAL_STATUSES,
  MAX_DEPTH,
  PASSING_STATUSES,
  classifyRuntime,
  markFor,
  collectReferences,
  inspectReference,
  manifestUrls,
  parseNodeRuntime,
  parseUses,
  splitSpec,
  workflowFiles,
} from '../scripts/check-action-runtimes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A manifest reader backed by a fixture map; anything absent is "no such action". */
const reader = manifests => async ref => {
  const key = ref.kind === 'local' ? ref.spec : ref.spec;
  if (!(key in manifests)) throw new Error(`action.yml not found for ${key}`);
  return { text: manifests[key], source: `fixture:${key}` };
};

const JS_ACTION = node => `name: fixture\nruns:\n  using: node${node}\n  main: index.js\n`;
const COMPOSITE = inner => `name: fixture\nruns:\n  using: composite\n  steps:\n${inner.map(i => `    - uses: ${i}`).join('\n')}\n    - run: echo hi\n      shell: bash\n`;

test('every `uses:` in a workflow is found, however it is written', () => {
  const yml = [
    'jobs:',
    '  a:',
    '    uses: owner/repo/.github/workflows/reusable.yml@main',   // job-level, no dash
    '  b:',
    '    steps:',
    '      - uses: actions/checkout@v7',
    '      - name: With a comment',
    '        uses: actions/cache@v6        # bump when v7 lands',
    `      - uses: "actions/setup-node@v7"`,
    "      - uses: 'actions/setup-java@v6'",
    '      - run: echo "uses: not-a-ref"',                        // prose, not a key
    '      - uses:',
    '',
  ];
  const found = parseUses(yml.join('\n'));
  assert.deepEqual(found.map(f => f.spec), [
    'owner/repo/.github/workflows/reusable.yml@main',
    'actions/checkout@v7',
    'actions/cache@v6',
    'actions/setup-node@v7',
    'actions/setup-java@v6',
  ], 'quotes and trailing comments must be stripped, prose and empty values ignored');
  assert.equal(found[1].line, 6, 'the line number is what makes a failure actionable');
});

test('a reference is classified without being fetched first', () => {
  assert.equal(splitSpec('actions/checkout@v7').kind, 'action');
  assert.equal(splitSpec('actions/checkout@v7').repo, 'checkout');
  assert.equal(splitSpec('actions/checkout@v7').subpath, '');
  assert.equal(splitSpec('github/codeql-action/upload-sarif@v3').subpath, 'upload-sarif/',
    'a subdirectory action keeps its path');
  assert.equal(splitSpec('./local/action').kind, 'local');
  assert.equal(splitSpec('docker://alpine:3.19').kind, 'docker');

  // A reusable workflow declares no runtime of its own — and it must be recognised even
  // though the path ends in a slash once split, or it gets fetched as an action.
  const reusable = splitSpec('owner/repo/.github/workflows/ci.yml@main');
  assert.equal(reusable.kind, 'workflow');
  assert.equal(splitSpec('owner/repo/.github/workflows/ci.yaml@v1').kind, 'workflow');

  for (const bad of ['actions/checkout', 'not-a-ref', 'https://example.com/a.yml@v1', '/@v1']) {
    assert.equal(splitSpec(bad).kind, 'invalid', `"${bad}" should be reported, not ignored`);
  }
});

test('manifests are looked up at the pinned ref', () => {
  const urls = manifestUrls({ owner: 'actions', repo: 'checkout', ref: 'v7', subpath: '' });
  assert.match(urls[0], /raw\.githubusercontent\.com\/actions\/checkout\/v7\/action\.yml$/);
  assert.match(urls[1], /action\.yaml$/, 'action.yaml is a valid spelling');
  const nested = manifestUrls({ owner: 'github', repo: 'codeql-action', ref: 'v3', subpath: 'upload-sarif/' });
  assert.match(nested[0], /codeql-action\/v3\/upload-sarif\/action\.yml$/);
});

test('the runtime is read from the manifest, not from the pin', () => {
  assert.equal(parseNodeRuntime(JS_ACTION(20)).major, 20);
  assert.equal(parseNodeRuntime(JS_ACTION(24)).major, 24);
  assert.equal(parseNodeRuntime('runs:\n  using: composite\n').major, null);
  assert.equal(parseNodeRuntime('name: no runs block\n').using, null);
  // Indented `using:` inside `runs:` is the normal shape; a quoted value is valid YAML.
  assert.equal(parseNodeRuntime('runs:\n  using: "node20"\n').using, 'node20');
});

test('anything behind the current major fails, newer is a warning, junk is not ignored', () => {
  assert.deepEqual(classifyRuntime(`node${CURRENT_NODE}`).status, 'current');
  assert.equal(classifyRuntime('node20').status, 'stale');
  assert.equal(classifyRuntime('node16').status, 'stale');
  assert.equal(classifyRuntime('node12').status, 'stale');
  assert.equal(classifyRuntime(`node${CURRENT_NODE + 2}`).status, 'ahead',
    'a runtime newer than this script knows about should not fail the build');
  assert.equal(classifyRuntime('composite').status, 'composite');
  assert.equal(classifyRuntime('docker').status, 'docker');
  assert.equal(classifyRuntime('nodejs').status, 'unrecognised');
  assert.equal(classifyRuntime(null).status, 'unknown');
  for (const status of ['stale', 'unrecognised', 'unknown'].map(s => [s, classifyRuntime(s === 'stale' ? 'node4' : s === 'unrecognised' ? 'nonsense' : null)])) {
    assert.ok(status[1].reason, `${status[0]} should explain itself`);
  }
});

test('no verdict can pass by being unrecognised', () => {
  // The guarantee this encodes: every status the check can produce is either a pass, an
  // informational note, or a failure. A new verdict added without classifying it would
  // otherwise render as ✔ and pass — which is how a guard quietly stops guarding.
  const produced = new Set([
    ...['node24', 'node20', 'node16', 'node12', 'node16', 'node26', 'composite', 'docker', 'nonsense'].map(v => classifyRuntime(v).status),
    classifyRuntime(null).status,
    'unreadable', 'invalid', 'skipped',
  ]);
  for (const status of produced) {
    const classified = FAILING_STATUSES.includes(status)
      || INFORMATIONAL_STATUSES.includes(status)
      || PASSING_STATUSES.includes(status);
    assert.ok(classified, `status \u201c${status}\u201d is not classified, so it would pass silently`);
    assert.notEqual(markFor(status), '?', `status \u201c${status}\u201d has no mark in the table`);
  }
  assert.ok(FAILING_STATUSES.includes('unknown'),
    'a manifest with no `runs.using` cannot be verified, so it must fail');
  assert.equal(markFor('unknown'), '✖');
  for (const status of FAILING_STATUSES) assert.equal(markFor(status), '✖');
  assert.deepEqual(FAILING_STATUSES.filter(s => INFORMATIONAL_STATUSES.includes(s)), [],
    'a verdict cannot be both a failure and informational');
});

test('a manifest that declares no runtime is a failure, not a shrug', async () => {
  const noRuntime = `name: something
runs:
  main: index.js
`;
  const records = await inspectReference({ ...splitSpec('owner/notanaction@v1'), sites: ['ci.yml:4'] },
    { readManifest: reader({ 'owner/notanaction@v1': noRuntime }) });
  assert.equal(records[0].status, 'unknown');
  assert.ok(FAILING_STATUSES.includes(records[0].status));
});

test('the runtime comparison is numeric, so no list has to be maintained', () => {
  // The failure mode of a hardcoded list is that it silently stops covering new (or
  // renumbered) runtimes. Everything below is derived from CURRENT_NODE.
  assert.equal(classifyRuntime(`node${CURRENT_NODE - 1}`).status, 'stale');
  assert.equal(classifyRuntime(`node${CURRENT_NODE + 1}`).status, 'ahead');
  assert.match(classifyRuntime('node20').reason, new RegExp(`Node ${CURRENT_NODE}`),
    'the message should say what to move to');
});

test('a composite action is followed into whatever it wraps', async () => {
  const records = await inspectReference({ ...splitSpec('owner/wrapper@v1'), sites: ['ci.yml:9'] }, {
    readManifest: reader({
      'owner/wrapper@v1': COMPOSITE(['actions/checkout@v4', 'actions/cache@v6']),
      'actions/checkout@v4': JS_ACTION(20),
      'actions/cache@v6': JS_ACTION(24),
    }),
  });
  const bySpec = Object.fromEntries(records.map(r => [r.spec, r.status]));
  assert.equal(bySpec['owner/wrapper@v1'], 'composite');
  assert.equal(bySpec['actions/checkout@v4'], 'stale', 'a stale action hidden inside a composite must still fail');
  assert.equal(bySpec['actions/cache@v6'], 'current');
  assert.match(records.find(r => r.spec === 'actions/checkout@v4').sites[0], /owner\/wrapper@v1 → actions\/checkout@v4/,
    'the chain that led there should be reported');
});

test('nested composites terminate and cannot loop forever', async () => {
  const a = 'owner/a@v1';
  const b = 'owner/b@v1';
  const records = await inspectReference({ ...splitSpec(a), sites: [] }, {
    readManifest: reader({
      [a]: COMPOSITE([b, 'actions/checkout@v4']),
      [b]: COMPOSITE([a]),                       // cycle back to a
      'actions/checkout@v4': JS_ACTION(20),
    }),
  });
  assert.equal(records.filter(r => r.spec === a).length, 1, 'each action is inspected once');
  assert.ok(records.some(r => r.status === 'stale'), 'the stale leaf is still reported');
});

test('a composite nested past the limit is reported rather than trusted', async () => {
  const chain = {};
  for (let i = 0; i < MAX_DEPTH + 2; i++) {
    chain[`owner/c${i}@v1`] = COMPOSITE([`owner/c${i + 1}@v1`]);
  }
  chain[`owner/c${MAX_DEPTH + 2}@v1`] = JS_ACTION(20);
  const records = await inspectReference({ ...splitSpec('owner/c0@v1'), sites: [] },
    { readManifest: reader(chain) });
  assert.ok(records.some(r => /nested deeper than/.test(r.reason || '')),
    `recursion should stop at ${MAX_DEPTH} and say so`);
});

test('a manifest that cannot be read is a failure, not a silent pass', async () => {
  const records = await inspectReference({ ...splitSpec('owner/missing@v1'), sites: ['ci.yml:3'] },
    { readManifest: reader({}) });
  assert.equal(records[0].status, 'unreadable');
  assert.match(records[0].reason, /not found/);
});

test('references that carry no runtime are recognised as such', async () => {
  const cases = [
    ['docker://alpine:3.19', 'docker'],
    ['owner/repo/.github/workflows/ci.yml@main', 'skipped'],
    ['not-a-ref', 'invalid'],
  ];
  for (const [spec, expected] of cases) {
    const parsed = splitSpec(spec);
    const records = await inspectReference({ ...parsed, sites: [] },
      { readManifest: async () => { throw new Error('should not be fetched'); } });
    assert.equal(records[0].status, expected, `${spec} → ${records[0].status}`);
  }
});

test('a local action is read from the workspace, and a missing one is a failure', async () => {
  const stale = await inspectReference({ ...splitSpec('./local/old'), sites: [] },
    { readManifest: reader({ './local/old': JS_ACTION(18) }) });
  assert.equal(stale[0].status, 'stale', 'local actions can pin an old runtime too');
  assert.equal(stale[0].using, 'node18');

  // Silently skipping a local action that cannot be read would be the same blind spot in a
  // different place, so it fails instead.
  const missing = await inspectReference({ ...splitSpec('./local/gone'), sites: [] },
    { readManifest: reader({}) });
  assert.equal(missing[0].status, 'unreadable');
});

test('CI actually runs it, before anything that needs node_modules', () => {
  // The guard is only worth anything if it is wired up: a script nobody runs is how the
  // Node 20 pins survived in the first place. Parsed by line rather than with a YAML
  // dependency, matching the rest of the suite.
  const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const lines = ci.split(/\r?\n/);
  const stepAt = lines.findIndex(l => /^\s*- name: Action runtimes\s*$/.test(l));
  assert.notEqual(stepAt, -1, 'ci.yml should have an "Action runtimes" step');

  const runAt = lines.findIndex((l, i) => i > stepAt && /^\s*run: npm run check:actions\s*$/.test(l));
  assert.notEqual(runAt, -1, 'that step should run `npm run check:actions`');

  const installAt = lines.findIndex(l => /^\s*- name: Install\s*$/.test(l));
  assert.notEqual(installAt, -1, 'ci.yml should still install dependencies');
  assert.ok(runAt < installAt,
    'the runtime check must run before `npm ci` — it needs no dependencies, so it should not wait on the install (or on anything the install could mask)');
  assert.match(ci, /GH_TOKEN: \$\{\{ github\.token \}\}/,
    'a token lets the contents-API fallback read actions raw cannot');
});

test("this repo's workflows all parse, and none is malformed or on a branch", () => {
  const files = workflowFiles([]);
  assert.ok(files.length >= 4, `expected the workflow files, found ${files.length}`);

  const refs = collectReferences(files);
  assert.ok(refs.length >= 8, `expected the pinned actions, found ${refs.length}`);
  for (const ref of refs) {
    assert.notEqual(ref.kind, 'invalid', `${ref.spec} (${ref.sites.join(', ')}) is unreadable, so it cannot be guarded`);
    if (ref.kind === 'action') {
      assert.ok(!/^(main|master)$/.test(ref.ref),
        `${ref.spec} is pinned to a branch — its runtime can change without a commit here`);
    }
    assert.ok(ref.sites.length, `${ref.spec} should record where it is used`);
  }
  // The actions this repo actually depends on, so a broken scanner cannot pass by finding
  // nothing: a parse regression would drop these and fail here.
  for (const expected of ['actions/checkout', 'actions/setup-node', 'actions/upload-artifact']) {
    assert.ok(refs.some(r => r.spec.startsWith(`${expected}@`)), `${expected} should be discovered`);
  }
});
