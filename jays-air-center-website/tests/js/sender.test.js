/**
 * @jest-environment jsdom
 */
const { sendEvent, _envelope } = require('../../js/analytics');

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
  navigator.sendBeacon = jest.fn().mockReturnValue(true);
});

test('envelope contains required fields', () => {
  const env = _envelope('page_view', { foo: 'bar' });
  expect(env).toMatchObject({
    event: 'page_view',
    visitor_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    session_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    page_path: expect.any(String),
    device: expect.stringMatching(/^(mobile|tablet|desktop)$/),
    ab_variant: expect.any(String),
    properties: { foo: 'bar' },
  });
});

test('sendEvent uses sendBeacon when available', () => {
  sendEvent('page_view', {});
  expect(navigator.sendBeacon).toHaveBeenCalledTimes(1);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('sendEvent falls back to fetch when sendBeacon missing', () => {
  delete navigator.sendBeacon;
  sendEvent('page_view', {});
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('sendEvent does not throw when storage is blocked', () => {
  const origSet = Storage.prototype.setItem;
  Storage.prototype.setItem = () => { throw new Error('blocked'); };
  expect(() => sendEvent('page_view', {})).not.toThrow();
  Storage.prototype.setItem = origSet;
});
