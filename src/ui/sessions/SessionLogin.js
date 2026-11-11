import { sessionJSON } from '../../campaigns/SessionConnection.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';

export async function ensureSession({
  fetch = globalThis.fetch,
  baseURL = globalThis.location.href,
} = {}) {
  const endpoint = (suffix = '') => new URL(`api/session${suffix}`, baseURL).href;
  try {
    return await sessionJSON(fetch, endpoint());
  } catch (error) {
    if (error.status !== 401) throw error;
  }
  const invitation = new URLSearchParams(globalThis.location.hash.slice(1)).get('invite');
  if (invitation) {
    try {
      const identity = await sessionJSON(fetch, endpoint('/join'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite: invitation }),
      });
      history.replaceState(null, '', location.pathname + location.search);
      return identity;
    } catch (error) {
      GameErrors.input(error, { component: 'SessionLogin', operation: 'joinInvitation' });
    }
  }
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const previousInert = new Map(
      [...document.body.children].map((element) => [element, element.inert])
    );
    for (const element of previousInert.keys()) element.inert = true;
    const root = document.createElement('section');
    root.className = 'campaign-picker';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Sign in to TavernTable');
    root.innerHTML = `<div class="campaign-shell">
      <h1>Sign in to TavernTable</h1>
      <p>The host controls the campaign. Players join with their own private invitation.</p>
      <output role="status" aria-label="Session sign-in status"></output>
      <form data-host-login><h2>DM / host</h2>
        <p>Use the private host access key in the host data directory. Do not share it with players.</p>
        <label>Host access key<input type="password" autocomplete="current-password" aria-label="Host access key" required></label>
        <button type="submit">Sign in as host</button>
      </form>
      <form data-player-login><h2>Player</h2>
        <label>Private invitation<input type="password" autocomplete="off" aria-label="Private invitation" required></label>
        <button type="submit">Join as player</button>
      </form></div>`;
    document.body.append(root);
    root.querySelector('input').focus();
    let pending = false;
    for (const form of root.querySelectorAll('form')) {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (pending) return;
        pending = true;
        for (const control of root.querySelectorAll('input,button')) control.disabled = true;
        const status = root.querySelector('output');
        status.textContent = 'Signing in...';
        const host = form.hasAttribute('data-host-login');
        const input = form.querySelector('input');
        let value = input.value.trim();
        if (!host && value.includes('#'))
          value = new URLSearchParams(value.split('#')[1]).get('invite') || '';
        try {
          const identity = await sessionJSON(fetch, endpoint(host ? '/host' : '/join'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(host ? { key: value } : { invite: value }),
          });
          input.value = '';
          for (const [element, inert] of previousInert) element.inert = inert;
          root.remove();
          previousFocus?.focus?.();
          history.replaceState(null, '', location.pathname + location.search);
          resolve(identity);
        } catch (error) {
          status.textContent = error.message;
          GameErrors.input(error, { component: 'SessionLogin', operation: 'signIn' });
        } finally {
          pending = false;
          for (const control of root.querySelectorAll('input,button')) control.disabled = false;
        }
      });
    }
  });
}
