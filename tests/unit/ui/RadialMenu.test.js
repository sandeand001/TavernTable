import RadialMenu from '../../../src/ui/components/RadialMenu.js';

describe('Available token radial actions', () => {
  let menu;
  let action;

  beforeEach(() => {
    menu = new RadialMenu().attach();
    action = jest.fn();
    menu.onAction(action);
    menu.show({ token: { id: 'token-1', name: 'Mannequin 1' }, screenX: 400, screenY: 300 });
  });

  afterEach(() => {
    menu.hide();
    menu.root.remove();
  });

  test('an unavailable wall-cover action is disabled for pointer and keyboard input', () => {
    menu.setActionAvailability({ 'action-cover': { allowed: false, reason: 'No eligible wall.' } });
    menu.root
      .querySelector('path[data-action-id="actions"]')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const cover = menu.root.querySelector('path[data-sub-action-id="action-cover"]');
    expect(cover.getAttribute('aria-disabled')).toBe('true');
    expect(cover.getAttribute('tabindex')).toBe('-1');
    cover.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    cover.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(action).not.toHaveBeenCalled();
    expect(menu.root.classList.contains('hidden')).toBe(false);
  });

  test('shows the character sheet, emotes, visual actions and one unavailable placeholder', () => {
    const buttons = [...menu.root.querySelectorAll('path[data-action-id]')];
    expect(buttons.map((button) => button.getAttribute('aria-label')).sort()).toEqual([
      'Actions',
      'Character Sheet',
      'Emotes',
      'Not yet available',
    ]);
    expect(menu.root.textContent).toContain('Mannequin 1');
  });

  test('the complete actions submenu uses separated targets rather than eight slivers', () => {
    menu.root
      .querySelector('path[data-action-id="actions"]')
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
    expect(menu.root.querySelectorAll('path[data-sub-action-id]')).toHaveLength(8);
    const parentLabel = menu.root.querySelector('.radial-sublabel[data-action-id="actions"]');
    expect(parentLabel.style.visibility).toBe('hidden');
    const angles = [...menu.root.querySelectorAll('.radial-submenu-icon')].map((icon) =>
      Number.parseFloat(icon.style.getPropertyValue('--angle'))
    );
    expect(angles).toHaveLength(8);
    for (let i = 1; i < angles.length; i++) {
      expect(angles[i] - angles[i - 1]).toBeGreaterThanOrEqual(24 - 1e-8);
    }
    menu.root
      .querySelector('path[data-sub-action-id="action-cast"]')
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
    expect(action).toHaveBeenCalledWith(expect.objectContaining({ actionId: 'action-cast' }));
    expect(parentLabel.style.visibility).toBe('');
  });

  test('an asynchronous result for a previous token cannot mark the current menu active', () => {
    const previous = { id: 'previous' };
    const current = { id: 'current' };
    menu.show({ token: previous });
    menu.setActiveCommand('actions', previous);
    expect(menu.root.querySelector('path[data-action-id="actions"]').dataset.active).toBe('true');
    menu.show({ token: current });
    menu.setActiveCommand('actions', previous);
    expect(
      menu.root.querySelector('path[data-action-id="actions"]').dataset.active
    ).toBeUndefined();
  });

  test('opens the character sheet action directly for its own token', () => {
    menu.root
      .querySelector('path[data-action-id="character-sheet"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({ actionId: 'character-sheet', tokenId: 'token-1' })
    );
    expect(menu.root.classList.contains('hidden')).toBe(true);
  });

  test('the unavailable placeholder never opens a submenu or dispatches an action', () => {
    const unavailable = menu.root.querySelector('path[data-action-id="unavailable"]');
    expect(unavailable.getAttribute('aria-disabled')).toBe('true');
    unavailable.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    unavailable.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(action).not.toHaveBeenCalled();
    expect(menu.root.querySelectorAll('[data-sub-action-id]')).toHaveLength(0);
  });

  test('keyboard activation opens the same emote submenu and keeps every current emote', () => {
    menu.root
      .querySelector('path[data-action-id="emotes"]')
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
    const emote = menu.root.querySelector('path[data-sub-action-id="emote-rumba"]');
    expect(emote).not.toBeNull();
    expect(menu.root.querySelectorAll('path[data-sub-action-id]')).toHaveLength(5);
    emote.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(action).toHaveBeenCalledWith(expect.objectContaining({ actionId: 'emote-rumba' }));
  });

  test('a closed menu is inert so its transparent SVG cannot intercept map controls', () => {
    expect(menu.root.inert).toBe(false);
    menu.hide();
    expect(menu.root.inert).toBe(true);
    menu.show({ token: { id: 'token-1', name: 'Mannequin 1' } });
    expect(menu.root.inert).toBe(false);
  });
});
