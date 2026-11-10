import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/api.js', import.meta.url), 'utf8')
  .replace(/^export /gm, '').replaceAll('import.meta.env.BASE_URL', '"/"');

function request(fetch) {
  const context = vm.createContext({ Headers, FormData, URLSearchParams, fetch });
  vm.runInContext(source, context);
  return vm.runInContext("getBootstrap({ view: 'explore' })", context);
}

test('HTTP failures retain server messages and status, not connection advice', async () => {
  for (const status of [400, 401, 403, 404, 429, 500, 503]) {
    await assert.rejects(request(async () => ({
      ok: false, status, json: async () => ({ error: 'A safe server message.' }),
    })), (error) => error.status === status && error.message === 'A safe server message.');
  }
});

test('HTML proxy failures report their HTTP status without reflecting the response', async () => {
  for (const status of [404, 502, 503]) {
    await assert.rejects(request(async () => ({
      ok: false, status, json: async () => { throw new SyntaxError('<private proxy details>'); },
    })), (error) => error.status === status
      && error.message.includes(`HTTP ${status}`)
      && !/connection|private proxy details/i.test(error.message));
  }
});

test('empty HTTP error envelopes receive an accurate fallback', async () => {
  await assert.rejects(request(async () => ({
    ok: false, status: 500, json: async () => ({}),
  })), /server could not complete.*HTTP 500/);
});

test('malformed or null successful JSON is rejected, not accepted as empty content', async () => {
  for (const json of [async () => { throw new SyntaxError('invalid'); }, async () => null]) {
    await assert.rejects(request(async () => ({ ok: true, status: 200, json })),
      (error) => error.status === 200 && /unreadable response/.test(error.message));
  }
});

test('transport failures and cancellations are distinct from HTTP failures', async () => {
  await assert.rejects(request(async () => { throw new TypeError('Failed to fetch'); }),
    (error) => error.status === 0 && /No response was received/.test(error.message));
  await assert.rejects(request(async () => { throw { name: 'AbortError' }; }), /cancelled/);
});

test('valid Explore responses and no-content responses still succeed', async () => {
  const data = { accounts: [], boards: [], posts: [], discovery: {} };
  assert.equal(await request(async () => ({ ok: true, status: 200, json: async () => data })), data);
  assert.equal(await request(async () => ({ ok: true, status: 204 })), null);
});
