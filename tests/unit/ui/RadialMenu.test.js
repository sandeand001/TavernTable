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

  test('keeps naming on the sheet, not in the radial menu', () => {
    const buttons = [...menu.root.querySelectorAll('path[data-action-id]')];
    expect(buttons.map((button) => button.getAttribute('aria-label')).sort()).toEqual([
      'Actions',
      'Character Sheet',
      'Emotes',
    ]);
    expect(menu.root.querySelector('[data-action-id="rename"]')).toBeNull();
    expect(menu.root.textContent).toContain('Mannequin 1');
  });

  test('a grounded flyer gets Take flight, while airborne controls replace it with Raise, Lower and Drop', () => {
    menu.setActionAvailability({ 'take-flight': { visible: true, allowed: true } });
    expect(menu.root.querySelector('path[data-action-id="take-flight"]')).not.toBeNull();
    expect(menu.root.querySelector('path[data-action-id="flight-raise"]')).toBeNull();
    menu.setActionAvailability({
      'flight-raise': { visible: true, allowed: true },
      'flight-lower': { visible: true, allowed: true },
      'flight-drop': { visible: true, allowed: true },
    });
    expect(menu.root.querySelector('path[data-action-id="take-flight"]')).toBeNull();
    expect(
      [...menu.root.querySelectorAll('path[data-action-id]')]
        .map((entry) => entry.getAttribute('aria-label'))
        .sort()
    ).toEqual(['Actions', 'Character Sheet', 'Drop', 'Emotes', 'Lower', 'Raise']);
  });

  test.each(['raise', 'lower'])(
    '%s exposes exactly 5, 10, 15 and 20 feet with unaffordable choices disabled',
    (kind) => {
      menu.setActionAvailability({
        [`flight-${kind}`]: { visible: true, allowed: true },
        [`flight-${kind}-15`]: { allowed: false, reason: 'Only 10 feet remain.' },
        [`flight-${kind}-20`]: { allowed: false, reason: 'Only 10 feet remain.' },
      });
      menu.root
        .querySelector(`path[data-action-id="flight-${kind}"]`)
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(
        [...menu.root.querySelectorAll('path[data-sub-action-id]')].map((entry) =>
          entry.getAttribute('aria-label')
        )
      ).toEqual([5, 10, 15, 20].map((feet) => `${kind === 'raise' ? '+' : '-'}${feet} ft`));
      const disabled = menu.root.querySelector(`path[data-sub-action-id="flight-${kind}-20"]`);
      expect(disabled.getAttribute('aria-disabled')).toBe('true');
      disabled.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(action).not.toHaveBeenCalled();
      menu.root
        .querySelector(`path[data-sub-action-id="flight-${kind}-10"]`)
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(action).toHaveBeenCalledWith(
        expect.objectContaining({ actionId: `flight-${kind}-10` })
      );
    }
  );

  test('unavailable Take flight cannot hide the menu or activate by pointer or keyboard', () => {
    menu.setActionAvailability({
      'take-flight': { visible: true, allowed: false, reason: 'Not enough movement.' },
    });
    const takeoff = menu.root.querySelector('path[data-action-id="take-flight"]');
    expect(takeoff.getAttribute('aria-disabled')).toBe('true');
    takeoff.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    takeoff.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(action).not.toHaveBeenCalled();
    expect(menu.root.classList.contains('hidden')).toBe(false);
  });

  test.each(['raise', 'lower'])(
    '%s shows signed elevation amounts directly without hovering',
    (kind) => {
      menu.setActionAvailability({ [`flight-${kind}`]: { visible: true, allowed: true } });
      menu.root
        .querySelector(`path[data-action-id="flight-${kind}"]`)
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const sign = kind === 'raise' ? '+' : '-';
      const options = [...menu.root.querySelectorAll('.radial-submenu-icon')];
      expect(options.map((option) => option.textContent)).toEqual(
        [5, 10, 15, 20].map((feet) => `${sign}${feet} ft`)
      );
      expect(options.every((option) => option.dataset.hover !== 'true')).toBe(true);
    }
  );

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
