/**
 * @jest-environment jsdom
 */
const { getOrCreateVisitorId, getOrCreateSessionId, getVariant, _hash } = require('../../js/identity');

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

const VARIANTS = ['a', 'b', 'c'];

test('visitor id is stable across calls', () => {
  const a = getOrCreateVisitorId();
  const b = getOrCreateVisitorId();
  expect(a).toBe(b);
  expect(a).toMatch(/^[0-9a-f-]{36}$/);
});

test('visitor id survives sessionStorage clear', () => {
  const a = getOrCreateVisitorId();
  sessionStorage.clear();
  expect(getOrCreateVisitorId()).toBe(a);
});

test('session id is stable within a session, new across', () => {
  const a = getOrCreateSessionId();
  expect(getOrCreateSessionId()).toBe(a);
  sessionStorage.clear();
  expect(getOrCreateSessionId()).not.toBe(a);
});

test('variant assignment is deterministic for a given visitor', () => {
  localStorage.setItem('jac_vid', 'fixed-visitor-id-1');
  const v1 = getVariant(VARIANTS);
  localStorage.removeItem('jac_ab');  // clear sticky, recompute
  const v2 = getVariant(VARIANTS);
  expect(v1).toBe(v2);
});

test('variant assignment is sticky in localStorage', () => {
  localStorage.setItem('jac_vid', 'visitor-x');
  const first = getVariant(VARIANTS);
  expect(localStorage.getItem('jac_ab')).toBe(first);
  // Even if VARIANTS list changes, sticky value wins if still valid
  const second = getVariant(VARIANTS);
  expect(second).toBe(first);
});

test('variant assignment is roughly uniform across many visitors', () => {
  const counts = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 3000; i++) {
    localStorage.clear();
    localStorage.setItem('jac_vid', `visitor-${i}`);
    counts[getVariant(VARIANTS)]++;
  }
  // Each bucket between 28% and 38% (allowing for hash distribution variance)
  for (const k of VARIANTS) {
    expect(counts[k]).toBeGreaterThan(840);
    expect(counts[k]).toBeLessThan(1140);
  }
});

test('hash is deterministic', () => {
  expect(_hash('hello')).toBe(_hash('hello'));
  expect(_hash('hello')).not.toBe(_hash('world'));
});
