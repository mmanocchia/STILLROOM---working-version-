import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const api = readFileSync(new URL('../src/api.js', import.meta.url), 'utf8').replace(/^export /gm, '').replaceAll('import.meta.env.BASE_URL', '"/"');
const settings = readFileSync(new URL('../src/settings.js', import.meta.url), 'utf8').replace(/^import .*$/m, '').replace(/^export /gm, '');

function load(fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({}) })) {
  const calls = [];
  const store = new Map();
  const listeners = {};
  const context = vm.createContext({
    Headers, FormData, URLSearchParams, crypto: webcrypto, queueMicrotask: () => {}, console,
    document: { addEventListener: (n, f) => { listeners[n] = f; }, querySelector: () => null, getElementById: () => null, visibilityState: 'visible' },
    window: { sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }, setTimeout: () => 0, clearTimeout: () => {} },
    fetch: async (url, options) => { calls.push({ url, options }); return fetchImpl(url, options); },
  });
  vm.runInContext(`${api}\n${settings}\nthis.m = { createSettings, generateReceipt, isReceipt, usernameProblem, isSixDigitCode, deletionReady, deletionBody, profileBody, settingsRouteAccess, RECEIPT_KEY };`, context);
  return { m: context.m, calls, store };
}
const esc = (v = '') => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function makeCtx(account, extra = {}) {
  return { escapeHTML: esc, icon: () => '', hrefFor: (p) => p, header: () => '<header></header>', renderEmpty: (t) => `<p>${t}</p>`,
    activeAccount: () => account, getAuthGeneration: () => 1, getRoute: () => '/settings', render: () => {}, navigate: () => {},
    persistAction: async () => ({}), refreshContent: async () => {}, endSession: async () => {}, signOutForDeletion: async () => {},
    loadSecurity: async () => { throw new Error('unavailable'); }, ...extra };
}

test('receipts are 64 lowercase hex from 32 random bytes', () => {
  const { m } = load();
  const r = m.generateReceipt(webcrypto);
  assert.match(r, /^[0-9a-f]{64}$/);
  assert.ok(m.isReceipt(r));
  assert.notEqual(r, m.generateReceipt(webcrypto));
  assert.equal(m.isReceipt('ABC'), false);
});

test('deletion confirmation rules for both roles', () => {
  const { m } = load();
  assert.equal(m.deletionReady({ typed: 'DELETE', permanent: true, cascade: false, role: 'Fan' }), true);
  assert.equal(m.deletionReady({ typed: 'delete', permanent: true, cascade: false, role: 'Fan' }), false);
  assert.equal(m.deletionReady({ typed: 'DELETE', permanent: false, cascade: true, role: 'Fan' }), false);
  assert.equal(m.deletionReady({ typed: 'DELETE', permanent: true, cascade: false, role: 'Artist' }), false);
  assert.equal(m.deletionReady({ typed: 'DELETE', permanent: true, cascade: true, role: 'Artist' }), true);
  const body = m.deletionBody({ role: 'Fan', cascade: true, receipt: 'r' });
  assert.equal(JSON.stringify(Object.keys(body).sort()), '["artistCascadeConfirmed","confirmation","receipt"]');
  assert.equal(body.artistCascadeConfirmed, false);
});

test('profile PATCH body is strict and never includes email or identity', () => {
  const { m } = load();
  const body = m.profileBody({ name: ' Ada ', username: '@Ada_1', biography: 'x', email: 'a@b.c', id: 'u1', role: 'Artist', profileImageAssetId: '' });
  assert.equal(JSON.stringify(body), '{"name":"Ada","username":"Ada_1","biography":"x","profileImageAssetId":null}');
});

test('validators', () => {
  const { m } = load();
  assert.equal(m.usernameProblem('ok_name'), '');
  assert.equal(m.usernameProblem('a'), '');
  assert.equal(m.usernameProblem('Name.with-hyphen'), '');
  assert.notEqual(m.usernameProblem('bad name!'), '');
  assert.equal(m.isSixDigitCode('123456'), true);
  assert.equal(m.isSixDigitCode('12345a'), false);
});

test('route gating: settings needs sign-in, recovery and status are public', () => {
  const { m } = load();
  assert.equal(m.settingsRouteAccess('/settings', false), 'login');
  assert.equal(m.settingsRouteAccess('/settings', true), 'allowed');
  assert.equal(m.settingsRouteAccess('/recover', false), 'public');
  assert.equal(m.settingsRouteAccess('/deletion-status', false), 'public');
});

test('guest settings render asks to sign in without requesting data', () => {
  const { m, calls } = load();
  const html = m.createSettings(makeCtx(null)).renderSettings();
  assert.match(html, /Sign in to manage/);
  assert.equal(calls.length, 0);
});

test('signed-in password recovery explicitly offers real logout before recovery', () => {
  const { m } = load();
  const ui = m.createSettings(makeCtx({ id: 'own', role: 'Fan' }, { getRoute: () => '/recover' }));
  assert.match(ui.renderRecover(), /data-action="recover-signout"/);
  assert.doesNotMatch(ui.renderRecover(), /name="recoveryEmail"/);
});

test('recovery and status pages render public forms', () => {
  const { m } = load();
  const ui = m.createSettings(makeCtx(null, { getRoute: () => '/recover' }));
  const html = ui.renderRecover();
  assert.match(html, /data-form="recover-request"/);
  assert.doesNotMatch(html, /password" value=/);
  const status = m.createSettings(makeCtx(null, { getRoute: () => '/deletion-status' })).renderDeletionStatus();
  assert.match(status, /Deletion|aria-busy/);
});
