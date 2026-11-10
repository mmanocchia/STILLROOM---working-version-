import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/clerkSecurity.js', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
function harness(overrides = {}) {
  const calls = [];
  const user = {
    passwordEnabled: true, primaryEmailAddress: { emailAddress: 'own@example.com' }, emailAddresses: [],
    async updatePassword(input) { calls.push(['password', input]); },
    async reload() {},
    ...overrides.user,
  };
  const session = {
    checkAuthorization: () => true, reload: async () => {},
    startVerification: async () => ({ status: 'needs_first_factor', supportedFirstFactors: [{ strategy: 'password' }] }),
    attemptFirstFactorVerification: async () => ({ status: 'complete' }), ...overrides.session,
  };
  const signIn = {
    async create(input) { calls.push(['recovery', input]); },
    async attemptFirstFactor(input) { calls.push(['code', input]); },
    async resetPassword(input) { calls.push(['reset', input]); signIn.status = 'complete'; },
    ...overrides.signIn,
  };
  const clerk = { user, session, client: { signIn } };
  const context = vm.createContext({ clerk });
  vm.runInContext(source + '\nthis.api={readLoginInfo,beginEmailChange,verifyEmailChange,changePassword,beginReverification,finishReverification,sendRecovery,completeRecovery,securityError};', context);
  return { api: context.api, calls, user, session };
}
test('passwords go only to the native Clerk user API and revoke other sessions', async () => {
  const { api, calls } = harness();
  await api.changePassword('current', 'new-password');
  assert.equal(calls[0][0], 'password');
  assert.equal(calls[0][1].signOutOfOtherSessions, true);
});
test('passwordless accounts do not get a fabricated password-change flow', async () => {
  const { api, calls } = harness({ user: { passwordEnabled: false } });
  assert.equal(api.readLoginInfo().passwordEnabled, false);
  await assert.rejects(api.changePassword('current', 'new-password'), /social or passwordless/);
  assert.equal(calls.length, 0);
});
test('sensitive changes fail closed without recent provider verification', async () => {
  const { api, calls } = harness({ session: { checkAuthorization: () => false } });
  await assert.rejects(api.changePassword('current', 'new-password'), /Verify your identity/);
  await assert.rejects(api.beginEmailChange('new@example.com'), /Verify your identity/);
  assert.equal(calls.length, 0);
});
test('an unverified new email is never promoted to primary', async () => {
  let promoted = false;
  const address = { id: 'email_new', verification: { status: 'unverified' }, attemptVerification: async () => ({ verification: { status: 'unverified' } }) };
  const { api } = harness({ user: { emailAddresses: [address], update: async () => { promoted = true; } } });
  await assert.rejects(api.verifyEmailChange(address, '000000'), /has not been verified/);
  assert.equal(promoted, false);
});
test('recovery requests do not disclose nonexistent accounts', async () => {
  const good = harness(), unknown = harness({ signIn: { create: async () => { throw { code: 'form_identifier_not_found' }; } } });
  assert.equal(JSON.stringify(await good.api.sendRecovery('own@example.com')), JSON.stringify(await unknown.api.sendRecovery('missing@example.com')));
  await assert.rejects(unknown.api.completeRecovery('424242', 'a-new-password'), /invalid or expired/);
});
test('recovery uses the installed legacy Clerk resource methods, not unavailable future APIs', async () => {
  const { api, calls } = harness();
  await api.sendRecovery('own@example.com');
  await api.completeRecovery('424242', 'a-new-password');
  assert.equal(calls[0][1].strategy, 'reset_password_email_code');
  assert.equal(calls[1][1].strategy, 'reset_password_email_code');
  assert.equal(calls[2][1].signOutOfOtherSessions, true);
});
test('partial reverification is not treated as complete; unsupported factors require real login', async () => {
  const partial = harness({ session: { attemptFirstFactorVerification: async () => ({ status: 'needs_second_factor' }) } });
  await assert.rejects(partial.api.finishReverification('password', 'current'), /not complete/);
  const unsupported = harness({ session: { startVerification: async () => ({ status: 'needs_first_factor', supportedFirstFactors: [{ strategy: 'passkey' }] }) } });
  assert.equal((await unsupported.api.beginReverification()).strategy, 'signin');
});
