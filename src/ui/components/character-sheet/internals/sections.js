import { ABILITIES, SKILLS } from '../../../../entities/characters/CharacterLibrary.js';
import { escapeHtml as escape } from '../../../characters/escapeHtml.js';

// -- Shared sheet markup --
export const signed = (value) => `${value >= 0 ? '+' : ''}${value}`;

export const title = (value) => value[0].toUpperCase() + value.slice(1);

export const checked = (value) => (value ? 'checked' : '');

export const selected = (value) => (value ? 'selected' : '');

export function field(label, path, value, type = 'text', limits = '') {
  return `<label class="sheet-field">${escape(label)}<input type="${type}"
    aria-label="${escape(label)}" data-character-field="${escape(path)}"
    value="${escape(value)}" ${limits}></label>`;
}

// -- Sheet sections --
export function renderIdentitySection(context, character) {
  const className =
    context.services.library.classes.get(character.classId)?.name || 'Custom / no class';
  return `<section class="sheet-identity-card" aria-label="Character information">
    <div class="sheet-identity-fields">
      <div class="sheet-identity-field"><span>Class:</span><output aria-label="Class">${escape(className)}</output></div>
      ${[
        ['Level', 'level', 'number', 'min="1" max="20" step="1" required'],
        ['Ancestry', 'ancestry', 'text', 'maxlength="160"'],
        ['Background', 'background', 'text', 'maxlength="160"'],
        ['Alignment', 'alignment', 'text', 'maxlength="160"'],
      ]
        .map(
          ([
            label,
            key,
            type,
            limits,
          ]) => `<label class="sheet-identity-field"><span>${label}:</span>
        <input type="${type}" aria-label="${label}" data-character-field="${key}" data-sheet-identity-value
          value="${escape(character[key])}" placeholder="Not set" title="Click to edit. Enter saves; Escape cancels." ${limits}>
      </label>`
        )
        .join('')}
    </div>
  </section>`;
}

export function renderCoreSection(context, character, stats) {
  return `
      <section class="sheet-card sheet-class-selection" aria-label="Class selection">
        <h4>Class selection (temporary)</h4>
        <label class="sheet-field">Class (single-class)<select aria-label="Character class" data-character-field="classId">
          <option value="" ${selected(character.classId === '')}>Custom / no class</option>
          ${context.services.catalog.classes.map((entry) => `<option value="${escape(entry.id)}" ${selected(entry.id === character.classId)}>${escape(entry.name)}</option>`).join('')}
        </select></label>
        <p class="sheet-reference">Temporary manual selection. A future character builder (charactermancer) will determine class.</p>
      </section>
      <div class="sheet-core-grid">
        <section class="sheet-card"><h4>Ability scores</h4>
          ${ABILITIES.map(
            (ability) => `<div class="sheet-ability">
            ${field(`${title(ability)} score`, `abilities.${ability}`, character.abilities[ability], 'number', 'min="1" max="30" step="1"')}
            <button type="button" data-sheet-action="roll" data-roll-kind="ability" data-key="${ability}" aria-label="Roll ${title(ability)} check">${signed(stats.abilityModifiers[ability])}</button>
            ${stats.abilityScores[ability] !== character.abilities[ability] ? `<small>Effective ${stats.abilityScores[ability]} from equipment</small>` : ''}
          </div>`
          ).join('')}
        </section>
        <section class="sheet-card"><h4>Movement</h4>
          ${field('Character speed (feet)', 'speed', character.speed, 'number', 'min="0" max="1000" step="1"')}
          <p class="sheet-reference">Base speed for this character. Combat shows remaining turn movement.</p>
          <h4>Saving throws</h4>
          ${ABILITIES.map(
            (ability) => `<div class="sheet-check-row">
            <label><input type="checkbox" aria-label="${title(ability)} save proficiency" data-character-field="saveOverrides.${ability}" ${checked(stats.saveProficiencies[ability])}>${title(ability)}</label>
            <button type="button" data-sheet-action="roll" data-roll-kind="save" data-key="${ability}" aria-label="Roll ${title(ability)} save">${signed(stats.saves[ability])}</button>
          </div>`
          ).join('')}
          <h4>Adjustments</h4>
          ${field('AC adjustment', 'acBonus', character.acBonus, 'number', 'min="-30" max="30" step="1"')}
          ${field('Initiative adjustment', 'initiativeBonus', character.initiativeBonus, 'number', 'min="-30" max="30" step="1"')}
          <label><input type="checkbox" data-character-field="inspiration" ${checked(character.inspiration)}> Inspiration</label>
        </section>
        <section class="sheet-card"><h4>Skills</h4>
          ${SKILLS.map(
            ({ id, name }) => `<div class="sheet-check-row">
            <label>${name}<select aria-label="${name} proficiency" data-character-field="skills.${id}" data-number>
              ${[
                [0, 'None'],
                [1, 'Proficient'],
                [2, 'Expertise'],
              ]
                .map(
                  ([value, text]) =>
                    `<option value="${value}" ${selected((character.skills[id] || 0) === value)}>${text}</option>`
                )
                .join('')}
            </select></label>
            <button type="button" data-sheet-action="roll" data-roll-kind="skill" data-key="${id}" aria-label="Roll ${name}">${signed(stats.skills[id])}</button>
          </div>`
          ).join('')}
        </section>
      </div>`;
}

export function renderEquipmentSection(context, character, stats) {
  const { library } = context.services;
  return `
      <div class="sheet-drop-zone" data-drop-kind="inventory" role="region" aria-label="Equipment drop area">
        <h4>Inventory</h4><p>Drop items here to carry them. Equip to apply supported benefits.</p>
        <div class="sheet-drop-equip" data-drop-kind="equip">Drop here to add and equip in one step</div>
      </div>
      <p>${stats.carriedWeight.toFixed(2)} lb listed weight${stats.unknownWeightItems ? `; ${stats.unknownWeightItems} entries have no listed weight` : ''}.
        Attuned: ${character.equipment.filter((item) => item.attuned).length}/3.</p>
      <div class="sheet-inventory">
        ${
          character.equipment
            .map((item) => {
              const entry = library.catalog.get(item.entryId);
              return `<article class="sheet-inventory-row" data-sheet-key="item:${item.id}">
            <div><strong>${escape(entry.name)}</strong><small>${escape(entry.automation === 'reference' ? 'Reference only - no automatic stat effects' : entry.requiresAttunement ? 'Requires attunement for automatic effects' : 'Supported equipped calculations')}</small></div>
            <label>Qty <input type="number" min="1" max="9999" step="1" aria-label="Quantity of ${escape(entry.name)}" data-item-action="quantity" data-item-id="${item.id}" value="${item.quantity}"></label>
            <label><input type="checkbox" aria-label="Equip ${escape(entry.name)}" data-item-action="equip" data-item-id="${item.id}" ${checked(item.equipped)}> Equip</label>
            ${entry.requiresAttunement ? `<label><input type="checkbox" aria-label="Attune ${escape(entry.name)}" data-item-action="attune" data-item-id="${item.id}" ${checked(item.attuned)}> Attune</label>` : ''}
            ${
              entry.weapon
                ? `<label>Proficiency <select aria-label="Proficiency for ${escape(entry.name)}" data-item-action="proficiency" data-item-id="${item.id}">
              <option value="auto" ${selected(item.proficiencyOverride == null)}>Class rules</option>
              <option value="yes" ${selected(item.proficiencyOverride === true)}>Proficient</option>
              <option value="no" ${selected(item.proficiencyOverride === false)}>Not proficient</option>
            </select></label>`
                : ''
            }
            <button type="button" data-sheet-action="details" data-entry-id="${escape(entry.id)}">Details</button>
            <button type="button" data-sheet-action="remove" data-instance-id="${item.id}" aria-label="Remove ${escape(entry.name)}">Remove</button>
          </article>`;
            })
            .join('') ||
          '<p>No equipment. Search the compendium or drag an item onto the sheet.</p>'
        }
      </div>
      <section class="sheet-card"><h4>Equipped attacks</h4>
        ${
          stats.attacks
            .map(
              (attack) => `<div class="sheet-attack-row">
          <strong>${escape(attack.name)}</strong>
          <span>${title(attack.ability)}${attack.proficient ? ' + proficiency' : ' (not proficient)'}</span>
          <button type="button" data-sheet-action="roll" data-roll-kind="attack" data-key="${attack.itemId}" aria-label="Attack with ${escape(attack.name)}">Attack ${signed(attack.attackBonus)}</button>
          <button type="button" data-sheet-action="roll" data-roll-kind="damage" data-key="${attack.itemId}">${escape(attack.damage)} ${escape(attack.damageType)}</button>
          ${attack.versatileDamage ? `<button type="button" data-sheet-action="roll" data-roll-kind="versatile" data-key="${attack.itemId}">Two-handed ${escape(attack.versatileDamage)}</button>` : ''}
        </div>`
            )
            .join('') || '<p>Equip a weapon to create an attack entry.</p>'
        }
      </section>`;
}

export function renderSpellsSection(context, character, stats) {
  const library = context.services.library;
  const prepared = character.spells.filter(
    (spell) => spell.prepared && library.catalog.get(spell.entryId).level > 0
  ).length;
  const maximum = stats.castingAbility
    ? Math.max(
        1,
        (character.classId === 'paladin' ? Math.floor(character.level / 2) : character.level) +
          stats.abilityModifiers[stats.castingAbility]
      )
    : 0;
  return `
      <div class="sheet-drop-zone" data-drop-kind="spells" role="region" aria-label="Spellbook drop area">
        <h4>Spellbook</h4><p>Drop spells here. Adding or preparing does not spend slots.</p>
      </div>
      <label class="sheet-field">Spellcasting ability<select aria-label="Spellcasting ability" data-character-field="castingAbility">
        <option value="auto" ${selected(character.castingAbility === 'auto')}>From class</option>
        <option value="" ${selected(character.castingAbility === '')}>None</option>
        ${ABILITIES.map((ability) => `<option value="${ability}" ${selected(character.castingAbility === ability)}>${title(ability)}</option>`).join('')}
      </select></label>
      <div class="sheet-summary">
        ${context._stat('Spell attack bonus', stats.spellAttack == null ? '-' : signed(stats.spellAttack), 'Spell attack')}
        ${context._stat('Spell save DC', stats.spellSaveDC ?? '-', 'Save DC')}
      </div>
      ${stats.preparesSpells ? `<p>Prepared ${prepared} / ${maximum} suggested by class/ability (limit not enforced).</p>` : ''}
      <div class="sheet-slots">${
        stats.spellSlots
          .filter((slot) => slot.max > 0)
          .map(
            (slot) =>
              `<label>Level ${slot.level}: ${slot.remaining}/${slot.max} left
          <input type="number" min="0" max="${slot.max}" step="1" aria-label="Used level ${slot.level} spell slots" data-used-slot="${slot.level}" value="${slot.used}"> used
        </label>`
          )
          .join('') ||
        '<p>No class spell slots at this level. Choose a casting class/level to use slots.</p>'
      }</div>
      ${
        character.concentration
          ? `<p class="sheet-concentration">Concentrating on ${escape(library.catalog.get(character.spells.find((spell) => spell.id === character.concentration).entryId).name)}
        <button type="button" data-sheet-action="end-concentration">End concentration</button></p>`
          : ''
      }
      <div class="sheet-spell-list">
        ${
          character.spells
            .map((owned) => {
              const entry = library.catalog.get(owned.entryId);
              const available =
                entry.level === 0
                  ? [0]
                  : stats.spellSlots
                      .filter((slot) => slot.level >= entry.level && slot.max > 0)
                      .map((slot) => slot.level);
              const level = available.includes(context.slotLevels.get(owned.id))
                ? context.slotLevels.get(owned.id)
                : (available[0] ?? entry.level);
              context.slotLevels.set(owned.id, level);
              const spell = library.spell(character.id, owned.id, level);
              const canCast =
                !!stats.castingAbility &&
                (entry.level === 0 ||
                  ((!stats.preparesSpells || owned.prepared) &&
                    stats.spellSlots[level - 1]?.remaining > 0));
              return `<article class="sheet-spell-row" data-sheet-key="spell:${owned.id}">
            <h5>${escape(entry.name)} <small>${entry.level ? `Level ${entry.level}` : 'Cantrip'} / ${escape(entry.school)}</small></h5>
            <p>${escape(entry.castingTime)} / ${escape(entry.range)} / ${escape(entry.duration)}${entry.concentration ? ' / concentration' : ''}</p>
            ${entry.level > 0 && stats.preparesSpells ? `<label><input type="checkbox" data-spell-id="${owned.id}" data-spell-action="prepare" aria-label="Prepare ${escape(entry.name)}" ${checked(owned.prepared)}> Prepared</label>` : ''}
            ${
              entry.level > 0
                ? `<label>Cast level <select data-slot-choice="${owned.id}" aria-label="Slot for ${escape(entry.name)}">
              ${(available.length ? available : [entry.level]).map((value) => `<option value="${value}" ${selected(level === value)}>${value} (${stats.spellSlots[value - 1]?.remaining || 0} left)</option>`).join('')}
            </select></label>`
                : ''
            }
            <button type="button" data-sheet-action="cast" data-instance-id="${owned.id}" ${canCast ? '' : 'disabled'} title="${canCast ? 'Use the tracked casting cost, spend the slot and track concentration; apply targets/effects manually' : 'Choose a casting ability, prepare if required, and ensure a slot remains'}">Cast${entry.level ? ' / use slot' : ''}</button>
            ${spell.attackBonus != null ? `<button type="button" data-sheet-action="roll" data-roll-kind="spell-attack" data-key="${owned.id}" title="Roll only: does not cast, spend a slot or use another action. Use Cast first.">Roll-only attack ${signed(spell.attackBonus)}</button>` : ''}
            ${spell.saveDC != null ? `<span>${title(spell.saveAbility)} save DC ${spell.saveDC}</span>` : ''}
            ${spell.damage.map((part, index) => (part.notation ? `<button type="button" data-sheet-action="roll" data-roll-kind="spell-damage" data-key="${owned.id}" data-part="${index}">${escape(part.notation)} ${escape(part.type)}</button>` : '')).join('')}
            ${spell.healing ? `<button type="button" data-sheet-action="roll" data-roll-kind="healing" data-key="${owned.id}">Heal ${escape(spell.healing)}</button>` : ''}
            <button type="button" data-sheet-action="details" data-entry-id="${escape(entry.id)}">Details</button>
            <button type="button" data-sheet-action="remove" data-instance-id="${owned.id}" aria-label="Remove ${escape(entry.name)}">Remove</button>
            <small class="sheet-reference">Slot/concentration tracking only. Apply spell effects, targets, extra projectiles and duration manually.</small>
          </article>`;
            })
            .join('') || '<p>No spells yet. Search the compendium and add one.</p>'
        }
      </div>`;
}
