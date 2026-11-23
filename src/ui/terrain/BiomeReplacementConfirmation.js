export const BIOME_REPLACEMENT_WARNING_KEY = 'taverntable.biome.skipReplacementWarning';
let activeConfirmation = null;

export function replacementWarningEnabled() {
  try {
    return window.localStorage.getItem(BIOME_REPLACEMENT_WARNING_KEY) !== 'true';
  } catch (error) {
    throw new Error('Could not read the map replacement warning preference', { cause: error });
  }
}

export function setReplacementWarningEnabled(enabled) {
  if (typeof enabled !== 'boolean')
    throw new TypeError('The map replacement warning setting must be on or off');
  try {
    if (enabled) window.localStorage.removeItem(BIOME_REPLACEMENT_WARNING_KEY);
    else window.localStorage.setItem(BIOME_REPLACEMENT_WARNING_KEY, 'true');
  } catch (error) {
    throw new Error('Could not save the map replacement warning preference', { cause: error });
  }
}

export function confirmBiomeReplacement() {
  if (!replacementWarningEnabled()) return Promise.resolve(true);
  activeConfirmation?.cancel();
  const previousFocus = document.activeElement;
  const root = document.createElement('div');
  root.className = 'biome-generation-review-backdrop';
  root.dataset.biomeReplacementConfirmation = '';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'biome-replacement-title');
  root.setAttribute('aria-describedby', 'biome-replacement-description');
  root.innerHTML = `
    <section class="biome-generation-review biome-replacement-warning">
      <header>
        <h2 id="biome-replacement-title">Replace this map?</h2>
        <p id="biome-replacement-description">Replace this map's terrain, structures, placed scenery and creature tokens?
          Character sheets and other maps will be kept. This cannot be undone.
          Linked areas and connections must remain valid.</p>
      </header>
      <form>
        <label class="biome-generation-checkbox">
          <input type="checkbox" name="skipWarning">
          <span>Don't show me this again</span>
        </label>
        <p role="alert" hidden></p>
        <footer>
          <button type="button" data-cancel>Cancel</button>
          <button type="submit" class="primary-button">Replace map</button>
        </footer>
      </form>
    </section>`;
  document.body.appendChild(root);
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const finish = (accepted) => {
    if (activeConfirmation?.root !== root) return;
    activeConfirmation = null;
    root.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
    resolve(accepted);
  };
  activeConfirmation = { root, cancel: () => finish(false) };
  root.querySelector('[data-cancel]').addEventListener('click', () => finish(false));
  root.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (root.querySelector('[name="skipWarning"]').checked) {
      try {
        setReplacementWarningEnabled(false);
      } catch (error) {
        const status = root.querySelector('[role="alert"]');
        status.hidden = false;
        status.textContent = `${error.message}. Uncheck the box to continue without saving it.`;
        return;
      }
    }
    finish(true);
  });
  root.addEventListener('click', (event) => {
    if (event.target === root) finish(false);
  });
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    } else if (event.key === 'Tab') {
      const focusable = [...root.querySelectorAll('input:not(:disabled),button:not(:disabled)')];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  root.querySelector('[data-cancel]').focus();
  return pending;
}
