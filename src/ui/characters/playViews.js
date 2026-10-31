import { ABILITIES, SKILLS } from '../../entities/characters/CharacterLibrary.js';
import { escapeHtml as escape } from './escapeHtml.js';
import { characterActionOptions } from '../../entities/characters/combat/actions.js';

const signed = (value) => `${value >= 0 ? '+' : ''}${value}`;
const title = (value) => value[0].toUpperCase() + value.slice(1);
const feet = (value) => String(Number(value.toFixed(2)));

function movementBar(status) {
  const { base, total, remaining, spent } = status.movement;
  const maximum = status.active ? total : base;
  const available = status.active ? remaining : base;
  const proportion = maximum > 0 ? Math.min(1, Math.max(0, available / maximum)) : 0;
  const description = !status.active
    ? 'Per move in free play. Start a turn to track remaining movement.'
    : status.downed
      ? '0 HP: voluntary combat movement is unavailable.'
      : !status.isTurn
        ? 'Waiting for your turn.'
        : `${feet(spent)} ft used this turn.`;
  return `<div class="sheet-play-movement">
    <div class="sheet-play-movement-heading">
      <strong>${status.active ? 'Remaining movement' : 'Movement per move'}</strong>
      <span><output aria-label="Movement remaining">${feet(available)}</output> / ${feet(maximum)} ft</span>
    </div>
    <div class="sheet-movement-meter" role="progressbar" aria-label="Remaining movement"
      aria-valuemin="0" aria-valuemax="${Math.max(1, maximum)}" aria-valuenow="${available}"
      aria-valuetext="${feet(available)} of ${feet(maximum)} feet; ${description}">
      <div class="sheet-movement-fill" style="width: ${100 * proportion}%"></div>
    </div>
    <p>${description}</p>
  </div>`;
}

// -- Ordered play cards --
function ordered(items, order = []) {
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...items].sort(
    (a, b) =>
      (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  );
}

function checkCards(stats) {
  const card = (home, label, rollKind, key, modifier) => ({
    id: `roll:${rollKind}:${key}`,
    kind: 'check',
    home,
    label,
    rollKind,
    key,
    modifier,
  });
  return [
    ...ABILITIES.map((key) => card('saves', `${title(key)} save`, 'save', key, stats.saves[key])),
    ...SKILLS.map((skill) => card('skills', skill.name, 'skill', skill.id, stats.skills[skill.id])),
    ...ABILITIES.map((key) =>
      card('abilities', `${title(key)} check`, 'ability', key, stats.abilityModifiers[key])
    ),
  ];
}

function cardControls(card, context, index, length) {
  if (!context.editingLayout) return '';
  const pinned = context.layout.favorites.includes(card.id);
  return `<div class="sheet-layout-card-tools">
    <button type="button" draggable="true" data-layout-drag="card" aria-label="Drag ${escape(card.label)}">Drag</button>
    <button type="button" data-play-layout-action="earlier" aria-label="Move ${escape(card.label)} earlier" ${index === 0 ? 'disabled' : ''}>Earlier</button>
    <button type="button" data-play-layout-action="later" aria-label="Move ${escape(card.label)} later" ${index === length - 1 ? 'disabled' : ''}>Later</button>
    <button type="button" data-play-layout-action="favorite" aria-pressed="${pinned}"
      aria-label="${pinned ? 'Unfavorite' : 'Favorite'} ${escape(card.label)}">${pinned ? 'Unfavorite' : 'Favorite'}</button>
  </div>`;
}

function sectionControls(id, label, editing, index, length) {
  if (!editing) return '';
  return `<div class="sheet-layout-section-tools">
    <button type="button" draggable="true" data-layout-drag="section" aria-label="Drag ${escape(label)} section">Drag section</button>
    <button type="button" data-play-layout-action="earlier" aria-label="Move ${escape(label)} section earlier" ${index === 0 ? 'disabled' : ''}>Earlier</button>
    <button type="button" data-play-layout-action="later" aria-label="Move ${escape(label)} section later" ${index === length - 1 ? 'disabled' : ''}>Later</button>
  </div>`;
}

function actionCards(actions, context) {
  const { stats, resources, customs, status, choices, editingLayout } = context;
  const disabled = editingLayout ? 'disabled' : '';
  return actions
    .map((action, index) => {
      const attributes = `data-sheet-key="play:${escape(action.id)}" data-play-card="${escape(action.id)}"
        data-play-home="${action.home}" data-play-label="${escape(action.label)}"`;
      if (action.kind === 'check') {
        return `<article class="sheet-play-roll-card" ${attributes}>${cardControls(action, context, index, actions.length)}
          <button type="button" data-sheet-action="roll" data-roll-kind="${action.rollKind}"
            data-key="${action.key}" aria-label="Roll ${escape(action.label)}" ${disabled}>
            <span>${escape(action.label)}</span><strong>${signed(action.modifier)}</strong></button>
        </article>`;
      }
      if (action.kind === 'reference') {
        return `<article class="sheet-play-action" ${attributes}>${cardControls(action, context, index, actions.length)}
          <button type="button" data-sheet-action="details" data-entry-id="${escape(action.entryId)}" ${disabled}>
            ${escape(action.label)}</button></article>`;
      }
      const resource = resources.find((entry) => entry.id === action.resourceId);
      const custom = customs.find((entry) => entry.id === action.customId);
      const remaining =
        custom?.reset === 'turn' && status.active
          ? custom.maximum - (status.customTurnUses[custom.id] || 0)
          : custom?.remaining;
      const choice = choices[action.id] || {};
      return `<article class="sheet-play-action" ${attributes}>${cardControls(action, context, index, actions.length)}
      <button type="button" data-sheet-action="use-action" data-action-id="${escape(action.id)}"
        aria-label="Use ${escape(action.label)}" title="${escape(action.note || 'Apply targets and effects manually')}" ${disabled}>
        <strong>${escape(action.label)}</strong><small>${escape(
          action.cost === 'attack'
            ? 'Attack action / remaining attack'
            : action.cost === 'bonus-attack'
              ? 'Remaining bonus attack'
              : action.cost === 'long'
                ? 'Long casting / activation time'
                : `${title(action.cost)}${action.kind === 'spell' && action.spellLevel ? `; slot ${action.slotLevel}` : ''}`
        )}
          ${resource ? ` | ${resource.maximum === null ? 'Unlimited' : resource.remaining} ${escape(resource.name)}` : ''}</small>
        ${custom && custom.maximum !== null ? `<small>${remaining}/${custom.maximum} uses</small>` : ''}
      </button>
      ${editingLayout && action.available === false ? '<small class="sheet-layout-unavailable">Currently unavailable</small>' : ''}
      ${
        action.kind === 'spell' && action.spellLevel > 0
          ? `<label>Slot
        <select data-play-slot="${escape(action.id)}" aria-label="Combat slot for ${escape(action.label)}" ${disabled}>
          ${action.slotLevels
            .map(
              (level) => `<option value="${level}" ${level === action.slotLevel ? 'selected' : ''}>
            ${level} (${stats.spellSlots[level - 1].remaining} left)</option>`
            )
            .join('')}
        </select></label>`
          : ''
      }
      ${
        action.variableCost
          ? `<label>Points
        <input type="number" min="1" max="${resource?.remaining ?? 1}" step="1"
          data-play-amount="${escape(action.id)}" aria-label="Points for ${escape(action.label)}"
          value="${escape(choice.amount ?? 1)}" ${disabled}></label>`
          : ''
      }
    </article>`;
    })
    .join('');
}

// -- Play sections --
function playSections(context, available, options) {
  const { library, token, mode, stats, status, layout, editingLayout, opened } = context;
  const combat = mode === 'combat';
  const ready = new Set(available.map((action) => action.id));
  const definitions = editingLayout ? characterActionOptions(library, token, options) : available;
  const home = (action) =>
    ['action', 'attack'].includes(action.cost)
      ? 'action'
      : ['bonus', 'bonus-attack'].includes(action.cost)
        ? 'bonus'
        : action.cost === 'reaction'
          ? 'reaction'
          : action.cost === 'free'
            ? 'free'
            : null;
  const useful = (action) =>
    ['spell', 'custom', 'ability'].includes(action.kind) ||
    ['hide', 'help', 'search-perception', 'search-investigation'].includes(action.id);
  const cards = [
    ...definitions
      .filter((action) =>
        combat ? home(action) && (editingLayout || status.active) : useful(action)
      )
      .map((action) => ({
        ...action,
        home: combat ? home(action) : 'utility',
        available: ready.has(action.id),
      })),
    ...checkCards(stats),
    ...(!combat
      ? library.get(token.characterSheetId).equipment.map((item) => ({
          id: `reference:${item.id}`,
          kind: 'reference',
          home: 'items',
          entryId: item.entryId,
          label: `${library.catalog.get(item.entryId).name} (${item.quantity})`,
        }))
      : []),
  ];
  const sections = combat
    ? [
        ['favorites', 'Favorites'],
        ['action', 'Action'],
        ['bonus', 'Bonus action'],
        ['reaction', 'Reaction'],
        ['free', 'No action'],
      ]
    : [
        ['favorites', 'Favorites'],
        ['utility', 'Useful options'],
        ['items', 'Carried reference items'],
      ];
  sections.push(
    ['saves', 'Saving throws'],
    ['skills', 'Skill checks'],
    ['abilities', 'Ability checks']
  );
  const sectionDefinitions = ordered(
    sections.map(([id, label]) => ({ id, label })),
    layout.sectionOrder
  );
  return sectionDefinitions
    .map(({ id, label }, index) => {
      const attributes = `data-play-section="${id}" data-play-label="${label}" data-sheet-key="play-section:${id}"`;
      const tools = sectionControls(id, label, editingLayout, index, sectionDefinitions.length);
      const entries = ordered(
        cards.filter((card) =>
          id === 'favorites'
            ? layout.favorites.includes(card.id)
            : card.home === id && !layout.favorites.includes(card.id)
        ),
        id === 'favorites' ? layout.favorites : layout.cardOrder[id]
      );
      if (!entries.length && !editingLayout && !['utility', 'items'].includes(id)) return '';
      if (['saves', 'skills', 'abilities'].includes(id)) {
        const open = id === 'abilities' ? opened[id] : opened[id] !== false;
        return `<section class="sheet-play-checks" ${attributes}>${tools}
        <details data-play-details="${id}" ${open ? 'open' : ''}><summary>${label}</summary>
          <div class="sheet-play-roll-grid">${actionCards(entries, context)}</div>
        </details></section>`;
      }
      return `<section class="sheet-play-action-group" aria-label="${label === 'Favorites' ? 'Favorite' : label} options" ${attributes}>
      <h4>${label}${id === 'bonus' && status.bonusAttacksRemaining ? ` (${status.bonusAttacksRemaining} strikes left)` : ''}</h4>${tools}
      <div class="sheet-play-action-grid">${
        actionCards(entries, context) ||
        `<p>${id === 'favorites' ? 'Choose Favorite on a card to pin it here.' : 'No options currently available.'}</p>`
      }</div>
    </section>`;
    })
    .join('');
}

// -- Shared play frame --
export function renderPlayView(context) {
  const {
    library,
    session,
    token,
    mode,
    choices = {},
    opened = {},
    editingLayout = false,
  } = context;
  const status = session.status(token);
  const stats = library.stats(token.characterSheetId);
  const options = {};
  for (const [id, choice] of Object.entries(choices)) {
    if (choice.slotLevel !== undefined) {
      const slot = stats.spellSlots[choice.slotLevel - 1];
      if (slot?.remaining > 0) options[id] = { slotLevel: choice.slotLevel };
    }
  }
  const available = session.availableActions(token, options);
  const combat = mode === 'combat';
  const activeName = session.activeToken
    ? library.get(session.activeToken.characterSheetId).name
    : null;
  const layout = library.layouts.page(token.characterSheetId, mode);
  const playContext = {
    ...context,
    choices,
    opened,
    editingLayout,
    stats,
    status,
    layout,
    resources: library.rest.status(token.characterSheetId).resources,
    customs: library.actions.list(token.characterSheetId),
  };
  return `<section class="sheet-play-view ${editingLayout ? 'sheet-layout-editing' : ''}" aria-label="${combat ? 'Combat play' : 'Non-combat play'}">
    <div class="sheet-layout-toolbar">
      <button type="button" data-play-layout-action="toggle" aria-label="Customize play layout"
        aria-pressed="${editingLayout}" ${!editingLayout && status.busy ? 'disabled' : ''}>${editingLayout ? 'Done customizing' : 'Customize layout'}</button>
      ${editingLayout ? '<button type="button" data-play-layout-action="reset" aria-label="Reset this page layout">Reset this page</button>' : ''}
      ${editingLayout ? '<small>Drag handles or use Earlier/Later. Drop cards into Favorites to pin them. Changes save automatically; play buttons are disabled.</small>' : ''}
    </div>
    ${
      status.downed
        ? `<p class="sheet-play-downed">0 HP: normal combat actions and voluntary movement are unavailable.
      Resolve unconsciousness, stabilization and special exceptions manually.
      <button type="button" data-sheet-action="roll" data-roll-kind="death" ${editingLayout ? 'disabled' : ''}>Roll death saving throw</button></p>`
        : ''
    }
    ${
      combat
        ? `
      <div class="sheet-play-turn" role="status">${
        !status.active
          ? 'Free play. Start a turn to track combat costs.'
          : status.isTurn
            ? 'Your turn'
            : activeName
              ? `${escape(activeName)} is taking a turn.`
              : 'Between turns: choose the next creature and start its turn.'
      }</div>
      <div class="sheet-play-turn-controls">
        ${!session.activeToken ? `<button type="button" data-sheet-action="turn-start" aria-label="Start turn" ${status.busy || editingLayout ? 'disabled' : ''}>Start Turn</button>` : ''}
        ${session.activeToken ? `<button type="button" data-sheet-action="turn-end" aria-label="End turn" ${status.busy || editingLayout ? 'disabled' : ''}>End ${status.isTurn ? 'Turn' : 'current turn'}</button>` : ''}
        ${status.active ? `<button type="button" data-sheet-action="combat-end" ${status.busy || editingLayout ? 'disabled' : ''}>End Combat / Free Play</button>` : ''}
        ${status.canUndo ? `<button type="button" data-sheet-action="use-undo" ${status.busy || editingLayout ? 'disabled' : ''}>Undo last use</button>` : ''}
        ${status.isTurn && status.attacksRemaining > 0 ? `<button type="button" data-sheet-action="attack-finish" ${editingLayout ? 'disabled' : ''}>Finish attack action (forfeit remaining attacks)</button>` : ''}
      </div>
      <div class="sheet-play-economy">
        <div><span>Action</span><output aria-label="Actions remaining">${status.actions}</output></div>
        <div><span>Bonus</span><output aria-label="Bonus actions remaining">${status.bonusActions}</output></div>
        <div><span>Reaction</span><output aria-label="Reactions remaining">${status.reactions}</output></div>
        <div><span>Attacks left</span><output aria-label="Attacks remaining"
          title="Includes attacks available from unspent actions and attacks left in an ongoing Attack action. Bonus attacks and reactions are separate.">${status.attacksAvailable}</output></div>
      </div>
      ${movementBar(status)}
      ${
        status.isTurn && !editingLayout
          ? `<details data-play-details="dm" ${opened.dm ? 'open' : ''}>
        <summary>Manual / DM turn corrections</summary>
        <label>Remaining feet <input type="number" min="0" max="10000" step="any"
          aria-label="DM remaining movement" data-play-dm-movement value="${escape(context.dmDraft ?? status.movement.remaining)}"></label>
        <button type="button" data-sheet-action="movement-adjust">Apply movement correction</button>
        <div class="sheet-play-dm-economy">
          ${[
            ['actions', 'actions'],
            ['bonusActions', 'bonus actions'],
            ['reactions', 'reactions'],
            ['attacksRemaining', 'ongoing attacks'],
            ['bonusAttacksRemaining', 'bonus attacks'],
          ]
            .map(
              ([key, label]) => `
            <label>${title(label)} remaining
              <input type="number" min="0" max="20" step="1" data-play-dm-economy="${key}"
                aria-label="DM ${label} remaining" value="${escape(context.dmEconomyDraft?.[key] ?? status[key])}">
            </label>`
            )
            .join('')}
        </div>
        <button type="button" data-sheet-action="economy-adjust">Apply action corrections</button>
        <p class="sheet-reference">This adjusts this turn only, not character speed. Ongoing attacks belong to an Attack action already started; unspent actions contribute separately to Attacks left. Undo refunds costs, not dice results or target effects.</p>
      </details>`
          : ''
      }
      ${!status.active && !editingLayout ? '<p>Start a turn to see available combat choices.</p>' : ''}`
        : `
      <p class="sheet-play-turn">${
        status.active
          ? 'Combat is active: this view does not bypass turn or resource costs.'
          : 'Free play: no action budget. Spell slots and limited-use resources are still spent.'
      }</p>`
    }
    <div class="sheet-play-action-groups" aria-label="Available ${combat ? 'combat' : 'non-combat'} options">
      ${playSections(playContext, available, options)}
    </div>
    <p class="sheet-reference">Costs and tracked uses are enforced; targets, trigger conditions, positioning and effects remain manual.
      <button type="button" data-sheet-section="core">Configure abilities in Core</button></p>
    <p class="sheet-reference">Ordinary checks and saves do not spend actions. Use Hide/Search when declaring those actions.</p>
  </section>`;
}
