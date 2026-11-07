import CampaignCharacters, {
  campaignRecordCharacterId,
} from '../../campaigns/CampaignCharacters.js';
import AssignedCharacterStore from '../../campaigns/AssignedCharacterStore.js';
import { CompendiumCatalog } from '../../entities/characters/CompendiumCatalog.js';
import CombatSession from '../../entities/characters/CombatSession.js';
import CharacterSheetWindow from '../components/CharacterSheetWindow.js';
import CompendiumSidebar from '../characters/CompendiumSidebar.js';
import { notifyCharacterChanged } from '../characters/characterServices.js';

export class SavedCharacterSheets {
  constructor({
    connection,
    state,
    catalog,
    library = null,
    gameManager = null,
    onChanged = () => {},
  }) {
    if (
      library &&
      (library.store?.identity?.role === 'player' ||
        gameManager?.characterServices?.sessionRole === 'player')
    )
      throw new Error('Shared campaign-library sheets require the DM workspace');
    this.onChanged = onChanged;
    this.sourceManager = gameManager;
    this.sharedLibrary = library !== null;
    this.library =
      library ||
      new CampaignCharacters({
        ...state,
        catalog,
        store: new AssignedCharacterStore(connection, state.campaign.id),
      });
    this.manager = {
      placedTokens: [],
      get campaignViewBusy() {
        return (
          !!gameManager?.campaignViewBusy || !!gameManager?.inputCoordinator?.savedCharacterPending
        );
      },
      get campaignMapFailure() {
        return gameManager?.campaignMapFailure || null;
      },
      token3DAdapter: {
        getSelectedToken: () => this.selected || null,
        setSelectedToken: (token) => {
          if (!this.manager.placedTokens.includes(token))
            throw new Error(
              this.sharedLibrary
                ? 'This character is not in the saved campaign library'
                : 'This character is not assigned to the player'
            );
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
      campaign: this.library.campaign,
      library: this.library,
      catalog: new CompendiumCatalog(this.library.sourceCatalog),
      combat,
      sessionRole: this.sharedLibrary ? 'dm' : 'player',
      sheetContext: this.sharedLibrary ? 'library' : 'assigned',
    };
    this.manager.characterServices = this.services;
    this._syncTokens();
    this._characterChanged = (event) => {
      if (event.detail?.gameManager === this.manager && !this.refreshing)
        this.onChanged(event.detail.characterId);
    };
    window.addEventListener('taverntable:characterChanged', this._characterChanged);
    this._worldChanged = (event) => {
      if (this.sourceManager && event.detail?.gameManager === this.sourceManager) this.refresh();
    };
    window.addEventListener('taverntable:campaignViewStateChanged', this._worldChanged);
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
    this.manager.placedTokens = this.library
      .list()
      .filter(
        (character) =>
          !this.sharedLibrary ||
          !this.sourceManager?.placedTokens.some((token) => token.characterSheetId === character.id)
      )
      .map((character) => {
        const token = previous.get(character.id) || {
          id: `${this.sharedLibrary ? 'saved' : 'assigned'}-sheet-${character.id}`,
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
    if (!token)
      throw new Error(
        this.sharedLibrary
          ? 'This character is not in the saved campaign library'
          : 'This saved character is not assigned to the player'
      );
    this.selected = token;
    await this.sheets.open(token);
  }

  async openCompendium(id) {
    if (!this.compendium) {
      const root = document.createElement('section');
      root.className = 'player-compendium';
      root.setAttribute(
        'aria-label',
        this.sharedLibrary ? 'Saved character compendium' : 'Assigned character compendium'
      );
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
    this.refreshing = true;
    try {
      const before = this.manager.placedTokens;
      if (!this.sharedLibrary) {
        if (!state) throw new Error('Player sheet refresh requires authorized campaign state');
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
      }
      this._syncTokens();
      for (const token of before)
        if (!this.manager.placedTokens.includes(token)) this.sheets.closeTab(token);
      for (const character of this.library.list())
        notifyCharacterChanged(this.manager, character.id);
      this.services.campaign = this.library.campaign;
    } finally {
      this.refreshing = false;
    }
    this.onChanged();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    window.removeEventListener('taverntable:characterChanged', this._characterChanged);
    window.removeEventListener('taverntable:campaignViewStateChanged', this._worldChanged);
    this.sheets.destroy();
    this.compendium?.destroy();
    this.compendiumRoot?.remove();
  }
}

export default SavedCharacterSheets;
