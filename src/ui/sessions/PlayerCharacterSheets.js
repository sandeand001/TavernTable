import CampaignCharacters, {
  campaignRecordCharacterId,
} from '../../campaigns/CampaignCharacters.js';
import AssignedCharacterStore from '../../campaigns/AssignedCharacterStore.js';
import { CompendiumCatalog } from '../../entities/characters/CompendiumCatalog.js';
import CombatSession from '../../entities/characters/CombatSession.js';
import CharacterSheetWindow from '../components/CharacterSheetWindow.js';
import CompendiumSidebar from '../characters/CompendiumSidebar.js';
import { notifyCharacterChanged } from '../characters/characterServices.js';

export default class PlayerCharacterSheets {
  constructor({ connection, state, catalog, onChanged = () => {} }) {
    this.onChanged = onChanged;
    this.library = new CampaignCharacters({
      ...state,
      catalog,
      store: new AssignedCharacterStore(connection, state.campaign.id),
    });
    this.manager = {
      placedTokens: [],
      token3DAdapter: {
        getSelectedToken: () => this.selected || null,
        setSelectedToken: (token) => {
          if (!this.manager.placedTokens.includes(token))
            throw new Error('This character is not assigned to the player');
          this.selected = token;
        },
        isMovementInProgress: () => false,
      },
    };
    const combat = new CombatSession({
      library: this.library,
      hasToken: (token) => this.manager.placedTokens.includes(token),
      isMoving: () => false,
      isSceneMoving: () => false,
    });
    this.services = {
      campaign: state.campaign,
      library: this.library,
      catalog: new CompendiumCatalog(catalog),
      combat,
      sessionRole: 'player',
    };
    this.manager.characterServices = this.services;
    this._syncTokens();
    this._characterChanged = (event) => {
      if (event.detail?.gameManager === this.manager) this.onChanged();
    };
    window.addEventListener('taverntable:characterChanged', this._characterChanged);
    this.sheets = new CharacterSheetWindow({
      gameManager: this.manager,
      characterServices: this.services,
      onOpenCompendium: (id) => this.openCompendium(id),
    }).attach();
  }

  _syncTokens() {
    const previous = new Map(
      this.manager.placedTokens.map((token) => [token.characterSheetId, token])
    );
    this.manager.placedTokens = this.library.list().map((character) => {
      const token = previous.get(character.id) || {
        id: `assigned-sheet-${character.id}`,
        type: 'mannequin',
        characterSheetId: character.id,
        nameMode: 'character',
      };
      token.name = character.name;
      return token;
    });
    if (this.selected && !this.manager.placedTokens.includes(this.selected)) this.selected = null;
  }

  async open(id) {
    const token = this.manager.placedTokens.find((entry) => entry.characterSheetId === id);
    if (!token) throw new Error('This saved character is not assigned to the player');
    this.selected = token;
    await this.sheets.open(token);
  }

  async openCompendium(id) {
    if (!this.compendium) {
      const root = document.createElement('section');
      root.className = 'player-compendium';
      root.setAttribute('aria-label', 'Assigned character compendium');
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = 'Close compendium';
      close.addEventListener('click', () => {
        root.hidden = true;
      });
      root.append(close);
      const body = document.createElement('div');
      root.append(body);
      document.body.append(root);
      this.compendiumRoot = root;
      this.compendium = new CompendiumSidebar({
        gameManager: this.manager,
        services: this.services,
      }).attach(body);
    }
    this.compendiumRoot.hidden = false;
    return this.compendium.open(id);
  }

  refresh(state) {
    const before = this.manager.placedTokens;
    const incomingIds = [
      ...new Set(state.records.map((row) => campaignRecordCharacterId(row.key))),
    ].sort();
    const currentIds = this.library
      .list()
      .map((character) => character.id)
      .sort();
    if (
      state.revision !== this.library.revision ||
      this.library.failure ||
      JSON.stringify(incomingIds) !== JSON.stringify(currentIds)
    )
      this.library.reload(state);
    this._syncTokens();
    for (const token of before)
      if (!this.manager.placedTokens.includes(token)) this.sheets.closeTab(token);
    for (const character of this.library.list()) notifyCharacterChanged(this.manager, character.id);
    this.services.campaign = state.campaign;
    this.onChanged();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    window.removeEventListener('taverntable:characterChanged', this._characterChanged);
    this.sheets.destroy();
    this.compendium?.destroy();
    this.compendiumRoot?.remove();
  }
}
