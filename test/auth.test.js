import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRequest, originAllowed, safeDecode, HttpError, ownTailnetIps } from '../server/auth.js';

const base = { port: 4321, hosts: ['mac.tail1.ts.net'], owner: 'me@github' };

test('localhost is allowed and is not remote', () => {
  assert.deepEqual(checkRequest({ ...base, host: 'localhost:4321' }), { ok: true, remote: false });
  assert.deepEqual(checkRequest({ ...base, host: '127.0.0.1:4321' }), { ok: true, remote: false });
});
test('a foreign host is refused (DNS rebinding)', () => assert.equal(checkRequest({ ...base, host: 'evil.com' }).ok, false));
test('the wrong port is refused', () => assert.equal(checkRequest({ ...base, host: 'localhost:9999' }).ok, false));
test('the tailnet name without an identity header is refused', () => assert.equal(checkRequest({ ...base, host: 'mac.tail1.ts.net', headers: {} }).ok, false));
test('the tailnet name with the wrong identity is refused', () => assert.equal(checkRequest({ ...base, host: 'mac.tail1.ts.net', headers: { 'tailscale-user-login': 'x@y' } }).ok, false));
test('the tailnet name with the owner identity is allowed and marked remote', () => assert.deepEqual(checkRequest({ ...base, host: 'mac.tail1.ts.net', headers: { 'tailscale-user-login': 'me@github' } }), { ok: true, remote: true }));
test('with no owner configured, remote access is refused', () => assert.equal(checkRequest({ ...base, owner: '', host: 'mac.tail1.ts.net', headers: { 'tailscale-user-login': 'me@github' } }).ok, false));
test('only our own origins may write', () => {
  assert.equal(originAllowed(undefined, base), true);
  assert.equal(originAllowed('http://localhost:4321', base), true);
  assert.equal(originAllowed('https://mac.tail1.ts.net', base), true);
  assert.equal(originAllowed('https://evil.com', base), false);
});
test('safeDecode turns a broken escape into a 400 instead of crashing', () => {
  assert.equal(safeDecode('a%20b'), 'a b');
  assert.throws(() => safeDecode('%'), (e) => e instanceof HttpError && e.status === 400);
});

test('this Mac calling itself through the tailnet name is refused', () => {
  const req = (xff) => ({ ...base, host: 'mac.tail1.ts.net', headers: { 'tailscale-user-login': 'me@github', 'x-forwarded-for': xff }, selfIps: ['100.64.0.5', 'fd7a:115c:a1e0::1'] });
  assert.equal(checkRequest(req('100.64.0.5')).ok, false);
  assert.equal(checkRequest(req('fd7a:115c:a1e0::1')).ok, false);
  assert.match(checkRequest(req('100.64.0.5')).error, /localhost:4321/);
  assert.equal(checkRequest(req('100.99.1.2')).ok, true);
  assert.equal(checkRequest({ ...base, host: 'localhost:4321', headers: { 'x-forwarded-for': '100.64.0.5' }, selfIps: ['100.64.0.5'] }).ok, true);
});
test('own tailnet addresses are picked from the interfaces', () => {
  const nets = { en0: [{ address: '192.168.1.5' }], utun4: [{ address: '100.101.102.103' }, { address: 'fd7a:115c:a1e0::1234' }, { address: '100.200.1.1' }], lo0: [{ address: '127.0.0.1' }] };
  assert.deepEqual(ownTailnetIps(nets), ['100.101.102.103', 'fd7a:115c:a1e0::1234']);
});
