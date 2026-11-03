import { Clerk } from '@clerk/clerk-js';
import { publishableKeyFromHost } from '@clerk/shared/keys';

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

export const clerk = clerkPubKey
  ? new Clerk(clerkPubKey, { proxyUrl: clerkProxyUrl || undefined })
  : null;

export async function loadClerk() {
  if (!clerk) throw new Error('Stillroom sign-in is not configured.');
  if (!window.__internal_ClerkUICtor) {
    const clerkDomain = atob(clerkPubKey.split('_')[2]).slice(0, -1);
    const uiRoot = (clerkProxyUrl || `https://${clerkDomain}`).replace(/\/$/, '');
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timeout = window.setTimeout(() => {
        script.remove();
        reject(new Error('The secure sign-in form took too long to load. Please refresh and try again.'));
      }, 25000);
      script.src = `${uiRoot}/npm/@clerk/ui@1/dist/ui.browser.js`;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.onload = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      script.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('The secure sign-in form could not load. Please refresh and try again.'));
      };
      document.head.appendChild(script);
    });
  }
  await clerk.load({
    ui: { ClerkUI: window.__internal_ClerkUICtor },
    appearance: clerkAppearance,
  });
  return clerk;
}

export const clerkAppearance = {
  variables: {
    colorPrimary: '#159A95',
    colorForeground: '#172E32',
    colorBackground: '#FFFFFF',
    colorInput: '#FFFFFF',
    colorInputForeground: '#172E32',
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
