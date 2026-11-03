import { Clerk } from '@clerk/clerk-js';

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const proxyUrl = import.meta.env.PROD
  ? `${window.location.origin}/api/__clerk`
  : undefined;

export const clerk = publishableKey
  ? new Clerk(publishableKey, proxyUrl ? { proxyUrl } : undefined)
  : null;

export async function loadClerk() {
  if (!clerk) throw new Error('Stillroom sign-in is not configured.');
  await clerk.load();
  return clerk;
}

export const clerkAppearance = {
  variables: {
    colorPrimary: '#159A95',
    colorText: '#172E32',
    colorBackground: '#FFFFFF',
    colorInputBackground: '#FFFFFF',
    colorInputText: '#172E32',
    borderRadius: '10px',
    fontFamily: 'Inter, sans-serif',
  },
  elements: {
    rootBox: 'stillroom-clerk-root',
    card: 'stillroom-clerk-card',
    headerTitle: 'stillroom-clerk-heading',
    formButtonPrimary: 'stillroom-clerk-submit',
    footerActionLink: 'stillroom-clerk-link',
    formFieldInput: 'stillroom-clerk-input',
  },
};
