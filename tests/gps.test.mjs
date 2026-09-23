/**
 * tests/gps.test.mjs — geofence distance maths (Haversine).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const { GPS } = loadApp();
const close = (actual, expected, tolerance, msg) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${msg || ''} expected ${expected}, got ${actual}`);

test('distance to the same point is zero', () => {
  assert.equal(GPS.distanceMeters(14.5995, 120.9842, 14.5995, 120.9842), 0);
});

test('one degree of latitude ≈ 111.2 km', () => {
  close(GPS.distanceMeters(0, 0, 1, 0), 111194.9, 2);
});

test('distance is symmetric', () => {
  const a = GPS.distanceMeters(14.5995, 120.9842, 14.6100, 121.0000);
  const b = GPS.distanceMeters(14.6100, 121.0000, 14.5995, 120.9842);
  close(a, b, 0.001, 'A→B must equal B→A');
});

test('a 100 m shift is measured accurately (geofence sizing)', () => {
  // ~0.0009° of latitude ≈ 100 m
  close(GPS.distanceMeters(14.5995, 120.9842, 14.6004, 120.9842), 100.07, 1);
});

test('dateline and hemisphere crossings stay sane', () => {
  close(GPS.distanceMeters(0, 179.999, 0, -179.999), 222.4, 1);
  close(GPS.distanceMeters(-33.8688, 151.2093, -33.8688, 151.2093), 0, 0.001);
});
