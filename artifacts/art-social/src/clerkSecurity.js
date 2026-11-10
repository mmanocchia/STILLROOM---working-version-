// Credential and verification operations go directly to Clerk. Never send
// passwords, recovery codes or email verification codes to the Stillroom API.
import { clerk } from './clerk.js';

function user() {
  if (!clerk?.user || !clerk?.session) throw new Error('Sign in to manage Login & Security.');
  return clerk.user;
}
function recentIdentity() {
  user();
  if (!clerk.session.checkAuthorization({ reverification: { level: 'first_factor', afterMinutes: 5 } })) {
    const error = new Error('Verify your identity before making this change.');
    error.code = 'reverification_required';
    throw error;
  }
}
export function readLoginInfo() {
  return { email: clerk?.user?.primaryEmailAddress?.emailAddress || '', passwordEnabled: Boolean(clerk?.user?.passwordEnabled) };
}
export async function beginEmailChange(email) {
  recentIdentity();
  const current = user();
  let address = current.emailAddresses.find((row) => row.emailAddress.toLowerCase() === email.trim().toLowerCase());
  if (!address) address = await current.createEmailAddress({ email: email.trim() });
  if (address.verification?.status !== 'verified') await address.prepareVerification({ strategy: 'email_code' });
  await current.reload();
  return address;
}
export async function verifyEmailChange(address, code) {
  recentIdentity();
  const current = user();
  if (!address || !current.emailAddresses.some((row) => row.id === address.id)) throw new Error('Start the email change again.');
  const verified = address.verification?.status === 'verified' ? address : await address.attemptVerification({ code });
  if (verified.verification?.status !== 'verified') throw new Error('The email has not been verified. Check the code and try again.');
  await current.update({ primaryEmailAddressId: verified.id });
  await current.reload();
  if (clerk.user.primaryEmailAddressId !== verified.id || clerk.user.primaryEmailAddress?.verification?.status !== 'verified') {
    throw new Error('Clerk has not confirmed the email change yet. Refresh Login & Security to check its status.');
  }
  return readLoginInfo();
}
export async function changePassword(currentPassword, newPassword) {
  recentIdentity();
  const current = user();
  if (!current.passwordEnabled) throw new Error('This account uses a social or passwordless login. Manage its credentials with your login provider.');
  await current.updatePassword({ currentPassword, newPassword, signOutOfOtherSessions: true });
}
export async function beginReverification() {
  user();
  const verification = await clerk.session.startVerification({ level: 'first_factor' });
  if (verification.status === 'complete') return { strategy: 'complete', status: 'complete' };
  const factors = verification.supportedFirstFactors || [];
  const password = factors.find((factor) => factor.strategy === 'password');
  if (password && clerk.user.passwordEnabled) return { strategy: 'password', factor: password };
  const email = factors.find((factor) => factor.strategy === 'email_code');
  if (email) {
    await clerk.session.prepareFirstFactorVerification({ strategy: 'email_code', emailAddressId: email.emailAddressId });
    return { strategy: 'email_code', factor: email };
  }
  // Unsupported factors are not simulated. A new real login can satisfy the
  // server's recent-authentication check for social/passkey-only accounts.
  return { strategy: 'signin' };
}
export async function finishReverification(strategy, value) {
  user();
  if (!['password', 'email_code'].includes(strategy)) throw new Error('Sign out and sign in again to verify your identity.');
  const result = await clerk.session.attemptFirstFactorVerification(strategy === 'password'
    ? { strategy, password: value } : { strategy, code: value });
  if (result.status !== 'complete') throw new Error('Identity verification is not complete. Sign in again using your usual login method.');
  await clerk.session.reload();
  return { status: 'complete' };
}

// The recovery request always has the same public outcome: account existence,
// passwordless-only accounts and provider delivery failures are not disclosed.
let recoveryStarted = false;
export async function sendRecovery(email) {
  recoveryStarted = false;
  if (!clerk?.client?.signIn) throw new Error('Secure sign-in is still loading. Wait a moment and try again.');
  try {
    const signIn = clerk?.client?.signIn;
    if (!signIn) throw new Error('Secure sign-in has not loaded yet.');
    await signIn.create({ strategy: 'reset_password_email_code', identifier: email.trim() });
    recoveryStarted = true;
  } catch { /* Identical response whether or not this account exists. */ }
  return { sent: true };
}
export async function completeRecovery(code, newPassword) {
  if (!recoveryStarted) throw new Error('This recovery code is invalid or expired. Request a new code and try again.');
  const signIn = clerk.client.signIn;
  await signIn.attemptFirstFactor({ strategy: 'reset_password_email_code', code });
  await signIn.resetPassword({ password: newPassword, signOutOfOtherSessions: true });
  if (!['complete', 'needs_second_factor'].includes(signIn.status)) throw new Error('Recovery is not complete. Return to Sign In to continue securely.');
  recoveryStarted = false;
  return { complete: true };
}
export function securityError(error, { recovery = false } = {}) {
  const code = error?.errors?.[0]?.code || error?.code || '';
  if (/reverification|session_verification/.test(code)) return 'Verify your identity, then try this change again.';
  if (/too_many|rate_limit/.test(code)) return 'Too many attempts. Wait a few minutes before trying again.';
  if (/expired|verification_expired/.test(code)) return 'This code has expired. Request a new code.';
  if (/already.*used|already_verified/.test(code)) return 'This code has already been used. Start a new verification.';
  if (/incorrect|invalid|not_found/.test(code)) return recovery
    ? 'This recovery code is invalid or expired. Request a new code and try again.'
    : 'The password or verification code is incorrect. Check it and try again.';
  if (/password.*(pwned|weak|length|validation)/.test(code)) return 'Choose a stronger password that meets the requirements shown by Clerk.';
  if (recovery) return 'Recovery could not be completed. Check your code or request a new one. You can also use your usual social login.';
  return code ? 'The secure change could not be completed. Check your details and try again.' : error?.message || 'The secure change could not be completed.';
}
