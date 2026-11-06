import { TARGET_AREA_SHAPES, TARGETING_LIMITS } from '../../config/targeting/SpellProfiles.js';
import { validateTargetingProfile } from '../../rules/targeting/profiles.js';
import { escapeHtml as escape } from './escapeHtml.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';

export default class TargetingProfileEditor {
  constructor({ library, onChanged }) {
    this.library = library;
    this.onChanged = onChanged;
    this.root = document.createElement('section');
    this.root.className = 'targeting-profile-editor';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Configure targeting profile');
    this.root.hidden = true;
    document.body.append(this.root);
    this.root.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.save();
    });
    this.root.addEventListener('click', (event) => {
      const action = event.target.closest('[data-profile-action]')?.dataset.profileAction;
      if (action === 'cancel') this.close(false);
      if (action === 'reset') void this.save(true);
    });
    this.root.addEventListener('change', (event) => {
      if (event.target.name !== 'attackMode') return;
      const mode = this.base.modes?.find((entry) => entry.id === event.target.value);
      if (!mode) return;
      const form = this.root.querySelector('form');
      form.elements.namedItem('rangeFeet').value = mode.long;
      form.elements.namedItem('normalRange').value = mode.normal;
    });
  }

  open(token, action) {
    if (this.pending) throw new Error('Finish the current targeting configuration');
    this.token = token;
    this.characterId = token.characterSheetId;
    this.action = action;
    const profile =
      action.targeting?.kind && action.targeting.kind !== 'manual'
        ? action.targeting
        : validateTargetingProfile({ version: 1, kind: 'tokens', rangeFeet: 30 });
    this.base = profile;
    const number = (
      label,
      name,
      value,
      max = TARGETING_LIMITS.rangeFeet,
      step = '1'
    ) => `<label>${label}<input type="number"
      name="${name}" aria-label="${label}" min="0" max="${max}" step="${step}" value="${value}"></label>`;
    const checked = (value) => (value ? 'checked' : '');
    this.root.innerHTML = `<form><h3>Targeting: ${escape(action.label)}</h3>
      <p>Manual overrides are static settings. Reviewed edition profiles resume when reset. Damage and saves remain manual.</p>
      ${profile.flightGrant ? '<p>Fly automatically grants temporary flight to willing creatures. Its flight grant is preserved when editing targeting.</p>' : ''}
      <label>Target kind<select name="kind" aria-label="Target kind">${(profile.flightGrant
        ? ['tokens']
        : ['tokens', 'area', 'point', 'self']
      )
        .map(
          (kind) =>
            `<option value="${kind}" ${kind === profile.kind ? 'selected' : ''}>${kind}</option>`
        )
        .join('')}</select></label>
      ${number('Target range (feet)', 'rangeFeet', profile.modes?.[0]?.long || profile.rangeFeet)}
      ${number('Minimum range (feet)', 'minRangeFeet', profile.minRangeFeet)}
      ${
        action.roll?.attack
          ? `<label>Attack type<select name="attackMode" aria-label="Target attack type">
        ${['melee', 'ranged', 'thrown'].map((mode) => `<option value="${mode}" ${(profile.modes?.[0]?.id || 'ranged') === mode ? 'selected' : ''}>${mode}</option>`).join('')}
        </select></label>${number('Normal attack range (feet)', 'normalRange', profile.modes?.[0]?.normal || profile.rangeFeet)}
        <label><input type="checkbox" name="ignoreCloseRangeDisadvantage" ${checked(profile.ignoreCloseRangeDisadvantage)}> Feature ignores ranged close-quarters disadvantage</label>
        <label><input type="checkbox" name="ignoreLongRangeDisadvantage" ${checked(profile.ignoreLongRangeDisadvantage)}> Feature ignores long-range disadvantage</label>`
          : ''
      }
      ${number('Maximum targets / projectiles', 'maxTargets', profile.maxTargets, TARGETING_LIMITS.targets)}
      ${number('Minimum targets / projectiles', 'minTargets', profile.minTargets, TARGETING_LIMITS.targets)}
      ${number('Maximum target size steps above caster (blank = any)', 'maxSizeDifference', profile.maxSizeDifference ?? '', 5)}
      <label><input type="checkbox" name="excludeSelf" ${checked(profile.excludeSelf)}> Creature targeting excludes caster</label>
      <label><input type="checkbox" name="requireCasterTarget" ${checked(profile.requireCasterTarget)}> Creature selection must include caster</label>
      <label><input type="checkbox" name="allowRepeat" ${checked(profile.allowRepeat)} ${profile.flightGrant ? 'disabled' : ''}> Allow multiple projectiles against one target</label>
      <label><input type="checkbox" name="requiresSight" ${checked(profile.requiresSight)}> Must see selected creatures</label>
      <label><input type="checkbox" name="requiresWilling" ${checked(profile.requiresWilling)} ${profile.flightGrant ? 'disabled' : ''}> Selected creatures must be willing</label>
      <label>Preferred allegiance<select name="preferred" aria-label="Preferred target allegiance">${[
        'any',
        'friendly',
        'hostile',
      ]
        .map(
          (relation) =>
            `<option value="${relation}" ${relation === profile.preferred ? 'selected' : ''}>${relation}</option>`
        )
        .join('')}</select></label>
      <label>Area shape<select name="shape" aria-label="Target area shape"><option value="">None</option>${TARGET_AREA_SHAPES.map(
        (shape) =>
          `<option value="${shape}" ${shape === profile.shape ? 'selected' : ''}>${shape}</option>`
      ).join('')}</select></label>
      <label>Origin<select name="anchor" aria-label="Target origin">${['point', 'caster']
        .map(
          (anchor) =>
            `<option value="${anchor}" ${anchor === profile.anchor ? 'selected' : ''}>${anchor}</option>`
        )
        .join('')}</select></label>
      ${number('Area radius / side / length (feet)', 'sizeFeet', profile.sizeFeet, TARGETING_LIMITS.areaFeet, 'any')}
      ${number('Line / wall thickness (feet)', 'widthFeet', profile.widthFeet, TARGETING_LIMITS.areaFeet, 'any')}
      ${number('Area height (feet)', 'heightFeet', profile.heightFeet, TARGETING_LIMITS.areaFeet, 'any')}
      ${number('Minimum origin height above caster (feet)', 'minOriginHeightFeet', profile.minOriginHeightFeet, TARGETING_LIMITS.areaFeet)}
      ${number('Lingering duration (caster turns)', 'lingerTurns', profile.lingerTurns, TARGETING_LIMITS.durationTurns)}
      ${!profile.flightGrant ? '<p>Tracked durations are visual reminders only; they do not apply conditions, statistics or movement abilities.</p>' : ''}
      <label><input type="checkbox" name="indefiniteDuration" ${checked(profile.indefiniteDuration)} ${profile.flightGrant ? 'disabled' : ''}> Duration ends manually / until dispelled</label>
      <label><input type="checkbox" name="ignoreOriginCover" ${checked(profile.ignoreOriginCover)}> Ignore origin total cover (sight requirements still apply)</label>
      <label>Expires at caster turn<select name="expiry" aria-label="Area expiry phase"><option value="start" ${profile.expiry === 'start' ? 'selected' : ''}>Start</option><option value="end" ${profile.expiry === 'end' ? 'selected' : ''}>End</option></select></label>
      <label><input type="checkbox" name="followCaster" ${checked(profile.followCaster)}> Area follows caster</label>
      <label><input type="checkbox" name="excludeCaster" ${checked(profile.excludeCaster)}> Exclude caster from area</label>
      <label><input type="checkbox" name="allowExclusions" ${checked(profile.allowExclusions)}> Choose creatures to exclude</label>
      ${number('Maximum area recipients (blank = all)', 'maxAreaTargets', profile.maxAreaTargets ?? '', TARGETING_LIMITS.targets)}
      <label><input type="checkbox" name="exclusionsRequireSight" ${checked(profile.exclusionsRequireSight)}> Excluded creatures must be visible</label>
      <p role="status"></p>
      <button type="submit">Save targeting profile</button>
      <button type="button" data-profile-action="reset">Use reviewed defaults</button>
      <button type="button" data-profile-action="cancel">Cancel</button></form>`;
    this.root.hidden = false;
    return new Promise((resolve) => {
      this.pending = resolve;
    });
  }

  async save(reset = false) {
    if (!this.pending || this.saving) return;
    const form = this.root.querySelector('form');
    const at = (name) => form.elements.namedItem(name);
    try {
      if (this.token.characterSheetId !== this.characterId)
        throw new Error('The loaded character changed; reopen its targeting configuration');
      let profile = null;
      if (!reset) {
        const kind = at('kind').value,
          area = kind === 'area';
        const anchor = at('anchor').value;
        const indefiniteDuration = !this.base.flightGrant && at('indefiniteDuration').checked;
        const lingerTurns = indefiniteDuration ? 0 : at('lingerTurns').valueAsNumber;
        const durationTarget = this.base.flightGrant
          ? null
          : area
            ? ['targets', 'caster'].includes(this.base.durationTarget)
              ? this.base.durationTarget
              : 'area'
            : kind === 'self'
              ? 'caster'
              : kind === 'point'
                ? 'point'
                : 'targets';
        const maxAreaTargets =
          area && at('maxAreaTargets').value !== '' ? at('maxAreaTargets').valueAsNumber : null;
        let modes;
        if (kind === 'tokens' && this.action.roll?.attack) {
          const selected = {
            id: at('attackMode').value,
            normal: at('normalRange').valueAsNumber,
            long: at('rangeFeet').valueAsNumber,
          };
          if (selected.id === 'melee') selected.long = selected.normal;
          modes = this.base.modes?.filter((mode) => mode.id !== selected.id) || [];
          modes.push(selected);
        }
        profile = validateTargetingProfile({
          ...this.base,
          version: 1,
          kind,
          rangeFeet: modes
            ? Math.max(...modes.map((mode) => mode.long))
            : kind === 'self' || (area && anchor === 'caster')
              ? 0
              : at('rangeFeet').valueAsNumber,
          minRangeFeet:
            kind === 'self' || (area && anchor === 'caster') ? 0 : at('minRangeFeet').valueAsNumber,
          maxTargets: at('maxTargets').valueAsNumber,
          minTargets: at('minTargets').valueAsNumber,
          maxSizeDifference:
            kind === 'tokens' && at('maxSizeDifference').value !== ''
              ? at('maxSizeDifference').valueAsNumber
              : null,
          excludeSelf: kind === 'tokens' && at('excludeSelf').checked,
          requireCasterTarget: kind === 'tokens' && at('requireCasterTarget').checked,
          allowRepeat: kind === 'tokens' && at('allowRepeat').checked,
          requiresSight: at('requiresSight').checked,
          requiresWilling: ['tokens', 'self'].includes(kind) && at('requiresWilling').checked,
          preferred: at('preferred').value,
          shape: area ? at('shape').value || null : null,
          anchor,
          sizeFeet: area ? at('sizeFeet').valueAsNumber : 0,
          widthFeet: at('widthFeet').valueAsNumber,
          heightFeet: at('heightFeet').valueAsNumber,
          lingerTurns,
          indefiniteDuration,
          durationLabel: indefiniteDuration
            ? this.base.indefiniteDuration
              ? this.base.durationLabel
              : 'Until ended manually'
            : lingerTurns > 0
              ? `${lingerTurns} caster turns`
              : '',
          durationTarget,
          movement:
            ['area', 'point'].includes(kind) &&
            (lingerTurns > 0 || indefiniteDuration) &&
            !(area && at('followCaster').checked)
              ? this.base.movement
              : null,
          variant: null,
          variantOptions: [],
          minOriginHeightFeet: at('minOriginHeightFeet').valueAsNumber,
          ignoreOriginCover: at('ignoreOriginCover').checked,
          expiry: at('expiry').value,
          followCaster: area && at('followCaster').checked,
          excludeCaster: area && at('excludeCaster').checked,
          allowExclusions: area && (at('allowExclusions').checked || maxAreaTargets !== null),
          maxAreaTargets,
          areaTargetsRequireSight: area && this.base.areaTargetsRequireSight,
          exclusionsRequireSight: area && at('exclusionsRequireSight').checked,
          attack: this.action.roll?.attack === true,
          modes,
          ignoreCloseRangeDisadvantage: at('ignoreCloseRangeDisadvantage')?.checked === true,
          ignoreLongRangeDisadvantage: at('ignoreLongRangeDisadvantage')?.checked === true,
        });
      }
      this.saving = true;
      for (const button of form.querySelectorAll('button')) button.disabled = true;
      await this.library.actions.setTargetingProfile(this.characterId, this.action.id, profile);
      this.onChanged(this.characterId);
      this.close(true);
    } catch (error) {
      GameErrors.validation(error, { component: 'TargetingProfileEditor', operation: 'save' });
      form.querySelector('[role="status"]').textContent = error.message;
      for (const button of form.querySelectorAll('button')) button.disabled = false;
    } finally {
      this.saving = false;
    }
  }

  close(saved) {
    const pending = this.pending;
    this.pending = null;
    this.root.hidden = true;
    pending?.(saved);
  }
  dispose() {
    this.close(false);
    this.root.remove();
  }
}
