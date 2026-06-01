/**
 * @jest-environment node
 */
const { handler } = require('../../netlify/functions/track');

// Mock firebase-admin BEFORE requiring track.js. The `add` mock is hoisted to module
// scope (via a getter on the mocked module's `_addMock`) so individual tests can assert
// on calls — Jest's `jest.mock()` factory captures variables by reference at hoist time,
// so we expose the mock via the module itself.
jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn(),
  getApps: jest.fn(() => []),
  cert: jest.fn(),
}));
jest.mock('firebase-admin/firestore', () => {
  const add = jest.fn().mockResolvedValue({ id: 'doc-id' });
  const collection = jest.fn(() => ({ add }));
  return {
    getFirestore: jest.fn(() => ({ collection })),
    FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TS') },
    __addMock: add,
    __collectionMock: collection,
  };
});

const firestoreMock = require('firebase-admin/firestore');
const addMock = firestoreMock.__addMock;
const collectionMock = firestoreMock.__collectionMock;

beforeEach(() => {
  addMock.mockClear();
  collectionMock.mockClear();
});

process.env.FIREBASE_SERVICE_ACCOUNT_JSON = Buffer.from(JSON.stringify({
  project_id: 'openavdb-prod',
  client_email: 'fake@example.com',
  private_key: 'fake',
})).toString('base64');

function makeEvent(overrides = {}) {
  return {
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', 'x-country': 'US' },
    body: JSON.stringify({
      event: 'page_view',
      visitor_id: '00000000-0000-4000-8000-000000000001',
      session_id: '00000000-0000-4000-8000-000000000002',
      page_path: '/',
      device: 'desktop',
      viewport: { w: 1440, h: 900 },
      ab_variant: 'join_waitlist',
      properties: {},
      ...overrides,
    }),
  };
}

test('rejects non-POST', async () => {
  const res = await handler({ httpMethod: 'GET' });
  expect(res.statusCode).toBe(405);
});

test('rejects missing event name', async () => {
  const res = await handler(makeEvent({ event: undefined }));
  expect(res.statusCode).toBe(400);
  expect(JSON.parse(res.body).error).toMatch(/event/i);
});

test('rejects unknown event name', async () => {
  const res = await handler(makeEvent({ event: 'rm_rf' }));
  expect(res.statusCode).toBe(400);
});

test('accepts valid page_view and writes to Firestore', async () => {
  const res = await handler(makeEvent());
  expect(res.statusCode).toBe(202);
  expect(collectionMock).toHaveBeenCalledWith('jac_analytics_events');
  expect(addMock).toHaveBeenCalledTimes(1);
  const written = addMock.mock.calls[0][0];
  expect(written).toMatchObject({
    event: 'page_view',
    visitor_id: '00000000-0000-4000-8000-000000000001',
    session_id: '00000000-0000-4000-8000-000000000002',
    page_path: '/',
    device: 'desktop',
    country: 'US',
    ab_variant: 'join_waitlist',
  });
  // ts must be a Firestore sentinel value, not undefined
  expect(written.ts).toBeDefined();
});

test('country is null (not undefined) when x-nf-geo is malformed', async () => {
  const ev = makeEvent();
  ev.headers = { 'content-type': 'application/json', 'x-nf-geo': 'not-json' };
  const res = await handler(ev);
  expect(res.statusCode).toBe(202);
  const written = addMock.mock.calls[0][0];
  expect(written.country).toBeNull();
});

test('country is extracted from x-nf-geo JSON header', async () => {
  const ev = makeEvent();
  ev.headers = {
    'content-type': 'application/json',
    'x-nf-geo': JSON.stringify({ country: { code: 'CA' } }),
  };
  const res = await handler(ev);
  expect(res.statusCode).toBe(202);
  const written = addMock.mock.calls[0][0];
  expect(written.country).toBe('CA');
});

test('rejects oversized payload (>4KB)', async () => {
  const huge = 'x'.repeat(5000);
  const res = await handler(makeEvent({ properties: { junk: huge } }));
  expect(res.statusCode).toBe(413);
});
