import { afterCharacterCommit } from '../../entities/characters/storageChanges.js';

const USE_ACTIONS = new Set([
  'use-action',
  'roll',
  'recent-roll',
  'cast',
  'turn-start',
  'turn-end',
  'combat-end',
  'use-undo',
  'attack-finish',
  'movement-adjust',
  'economy-adjust',
]);
export const PLAY_LAYOUT_DRAG_TYPE = 'application/x-taverntable-play-layout';

function moveBefore(order, id, before) {
  const result = order.filter((item) => item !== id);
  const index = before === null ? result.length : result.indexOf(before);
  if (index < 0) throw new Error('The layout destination is no longer available');
  result.splice(index, 0, id);
  return result;
}

export default class PlayLayoutControls {
  constructor(context) {
    this.context = context;
    this.editing = false;
    this.signature = null;
    this.drag = null;
    this.dragText = null;
    this.onClick = (event) => this._click(event);
    context.root.addEventListener('click', this.onClick, true);
    this.dragHandlers = {
      dragstart: (event) => this._dragStart(event),
      dragover: (event) => this._dragOver(event),
      drop: (event) => this._drop(event),
      dragend: () => this._clearDrag(),
    };
    for (const [type, handler] of Object.entries(this.dragHandlers)) {
      context.root.addEventListener(type, handler);
    }
  }

  // -- Context and lifecycle --
  sync() {
    const signature = `${this.context.characterId}:${this.context.section}`;
    if (signature !== this.signature) {
      this.editing = false;
      this.signature = signature;
      this._clearDrag();
    }
  }

  clear() {
    this.editing = false;
    this.signature = null;
    this._clearDrag();
  }

  destroy() {
    this.context.root.removeEventListener('click', this.onClick, true);
    for (const [type, handler] of Object.entries(this.dragHandlers)) {
      this.context.root.removeEventListener(type, handler);
    }
    this.clear();
  }

  // -- Editing without activating play buttons --
  _click(event) {
    const button = event.target.closest('button');
    if (!button) return;
    const action = button.dataset.playLayoutAction;
    if (!action) {
      if (this.editing && USE_ACTIONS.has(button.dataset.sheetAction)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.context._failure(
          new Error('Finish customizing the layout before using play options'),
          'playLayout'
        );
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    try {
      const { services, token, characterId, section } = this.context;
      if (services.library.isSaving)
        throw new Error('Finish saving the current layout or character change first');
      if (!['combat', 'noncombat'].includes(section))
        throw new Error('Open a play page to arrange it');
      if (action === 'toggle') {
        if (!this.editing && services.combat.status(token).busy)
          throw new Error('Finish the current roll or movement before customizing');
        this.editing = !this.editing;
        this._clearDrag();
        this.context._run(() => {}, '', false);
        return;
      }
      if (!this.editing) throw new Error('Turn on Customize layout first');
      if (action === 'reset') {
        if (
          this.context.root.ownerDocument.defaultView.confirm(
            "Reset this page's arrangement and Favorites? Character statistics, resources and the other page will not change."
          )
        ) {
          afterCharacterCommit(
            this.context._run(
              () => services.library.layouts.resetPage(characterId, section),
              'This play page was reset.'
            ),
            (saved) => {
              if (saved)
                this.context.root.querySelector('[data-play-layout-action="reset"]')?.focus();
            }
          );
        }
        return;
      }
      if (['earlier', 'later'].includes(action)) {
        this._move(button, action === 'earlier' ? -1 : 1);
        return;
      }
      if (action !== 'favorite') throw new Error('Unsupported layout control');
      const card = button.closest('[data-play-card]');
      if (!card) throw new Error('The play card is no longer available');
      const id = card.dataset.playCard;
      const page = services.library.layouts.page(characterId, section);
      page.favorites = page.favorites.includes(id)
        ? page.favorites.filter((item) => item !== id)
        : [...page.favorites, id];
      const signature = this.signature;
      afterCharacterCommit(
        this.context._run(
          () => services.library.layouts.savePage(characterId, section, page),
          'Play layout saved.'
        ),
        (saved) => {
          if (saved && signature === this.signature) this._focus('favorite', id);
        }
      );
    } catch (error) {
      this.context._failure(error, 'playLayout');
    }
  }

  // -- Ordering and keyboard focus --
  _move(button, direction) {
    const card = button.closest('[data-play-card]');
    const section = button.closest('[data-play-section]');
    const node = card || section;
    if (!node || !section) throw new Error('The layout item is no longer available');
    const attribute = card ? 'data-play-card' : 'data-play-section';
    const siblings = Array.from(node.parentElement.children)
      .filter((item) => item.hasAttribute(attribute))
      .map((item) => item.getAttribute(attribute));
    const id = node.getAttribute(attribute);
    const index = siblings.indexOf(id);
    if (index + direction < 0 || index + direction >= siblings.length) {
      throw new Error('This item is already at the edge of its section');
    }
    const before = direction < 0 ? siblings[index - 1] : (siblings[index + 2] ?? null);
    const { services, characterId, section: mode } = this.context;
    const page = services.library.layouts.page(characterId, mode);
    const sectionId = section.dataset.playSection;
    const stored = card
      ? sectionId === 'favorites'
        ? page.favorites
        : page.cardOrder[sectionId] || []
      : page.sectionOrder;
    const ordered = moveBefore([...new Set([...stored, ...siblings])], id, before);
    if (!card) page.sectionOrder = ordered;
    else if (sectionId === 'favorites') page.favorites = ordered;
    else page.cardOrder[sectionId] = ordered;
    const signature = this.signature;
    afterCharacterCommit(
      this.context._run(
        () => services.library.layouts.savePage(characterId, mode, page),
        'Play layout saved.'
      ),
      (saved) => {
        if (saved && signature === this.signature)
          this._focus(button.dataset.playLayoutAction, card ? id : null, sectionId);
      }
    );
  }

  _focus(action, cardId = null, sectionId = null) {
    const choices = Array.from(
      this.context.root.querySelectorAll('[data-play-layout-action]')
    ).filter((button) =>
      cardId
        ? button.closest('[data-play-card]')?.dataset.playCard === cardId
        : !button.closest('[data-play-card]') &&
          button.closest('[data-play-section]')?.dataset.playSection === sectionId
    );
    const control =
      choices.find((button) => button.dataset.playLayoutAction === action && !button.disabled) ||
      choices.find((button) => !button.disabled);
    control?.focus();
  }

  // -- Scoped native drag and drop --
  _hasDrag(event) {
    return Array.from(event.dataTransfer?.types || []).includes(PLAY_LAYOUT_DRAG_TYPE);
  }

  _dragStart(event) {
    const handle = event.target.closest('[data-layout-drag]');
    if (!handle) return;
    try {
      if (!this.editing || !event.dataTransfer || this.context.services.library.isSaving)
        throw new Error('Use Customize layout and its move controls to arrange cards');
      const kind = handle.dataset.layoutDrag;
      const node = handle.closest(kind === 'card' ? '[data-play-card]' : '[data-play-section]');
      if (!node) throw new Error('The layout item is no longer available');
      this.drag = {
        nonce: globalThis.crypto.randomUUID(),
        kind,
        id: kind === 'card' ? node.dataset.playCard : node.dataset.playSection,
        characterId: this.context.characterId,
        mode: this.context.section,
      };
      this.dragText = JSON.stringify(this.drag);
      event.dataTransfer.setData(PLAY_LAYOUT_DRAG_TYPE, this.dragText);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setDragImage?.(node, 16, 16);
      node.classList.add('sheet-layout-dragging');
    } catch (error) {
      event.preventDefault();
      this._clearDrag();
      this.context._failure(error, 'playLayoutDrag');
    }
  }

  _dragOver(event) {
    if (!this._hasDrag(event) || !this.drag || !this.editing) return;
    const section = event.target.closest('[data-play-section]');
    if (!section || !this.context.root.contains(section)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const target =
      this.drag.kind === 'card' ? event.target.closest('[data-play-card]') || section : section;
    for (const item of this.context.root.querySelectorAll('.sheet-layout-drop-target')) {
      if (item !== target) item.classList.remove('sheet-layout-drop-target');
    }
    target.classList.add('sheet-layout-drop-target');
  }

  _drop(event) {
    if (!this._hasDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      if (
        !this.editing ||
        this.context.services.library.isSaving ||
        !this.drag ||
        event.dataTransfer.getData(PLAY_LAYOUT_DRAG_TYPE) !== this.dragText ||
        this.drag.characterId !== this.context.characterId ||
        this.drag.mode !== this.context.section
      ) {
        throw new Error(
          'This layout drag belongs to a different character or page; start it again'
        );
      }
      const target = event.target.closest('[data-play-section]');
      const selector = this.drag.kind === 'card' ? '[data-play-card]' : '[data-play-section]';
      const source = Array.from(this.context.root.querySelectorAll(selector)).find(
        (node) =>
          (this.drag.kind === 'card' ? node.dataset.playCard : node.dataset.playSection) ===
          this.drag.id
      );
      if (!source || !target || !this.context.root.contains(target))
        throw new Error('Drop onto an available play section or card');
      const { services, characterId, section: mode } = this.context;
      const page = services.library.layouts.page(characterId, mode);
      const id = this.drag.id;
      if (this.drag.kind === 'section') {
        if (source === target) return;
        const ids = Array.from(target.parentElement.children)
          .filter((node) => node.hasAttribute('data-play-section'))
          .map((node) => node.dataset.playSection);
        page.sectionOrder = moveBefore(
          [...new Set([...page.sectionOrder, ...ids])],
          id,
          target.dataset.playSection
        );
      } else {
        const group = target.dataset.playSection;
        if (group !== 'favorites' && group !== source.dataset.playHome) {
          throw new Error(
            'Cards stay within their original section, or can be pinned in Favorites'
          );
        }
        const beforeCard = event.target.closest('[data-play-card]');
        if (beforeCard === source) return;
        const before = beforeCard?.dataset.playCard ?? null;
        if (group === 'favorites') {
          page.favorites = moveBefore([...new Set([...page.favorites, id])], id, before);
        } else {
          page.favorites = page.favorites.filter((item) => item !== id);
          const ids = Array.from(
            target.querySelectorAll('[data-play-card]'),
            (node) => node.dataset.playCard
          );
          page.cardOrder[group] = moveBefore(
            [...new Set([...(page.cardOrder[group] || []), ...ids, id])],
            id,
            before
          );
        }
      }
      this.context._run(
        () => services.library.layouts.savePage(characterId, mode, page),
        'Play layout saved.'
      );
    } catch (error) {
      this.context._failure(error, 'playLayoutDrop');
    } finally {
      this._clearDrag();
    }
  }

  _clearDrag() {
    this.drag = null;
    this.dragText = null;
    for (const node of this.context.root.querySelectorAll(
      '.sheet-layout-drop-target, .sheet-layout-dragging'
    )) {
      node.classList.remove('sheet-layout-drop-target', 'sheet-layout-dragging');
    }
  }
}
