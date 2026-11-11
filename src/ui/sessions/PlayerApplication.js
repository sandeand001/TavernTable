import SessionConnection from '../../campaigns/SessionConnection.js';
import { loadBundledResources } from '../../resources/ResourceSeeds.js';
import PlayerGameApplication from './PlayerGameApplication.js';
import { validatePlayerState } from '../../campaigns/PlayerPublicProtocol.js';

export async function preparePlayerApplication({
  gameManager,
  identity,
  connection = new SessionConnection({ identity }),
  resources = null,
  openSheet = null,
}) {
  if (identity.role !== 'player')
    throw new Error('Player gameplay requires an authenticated player session');
  let app;
  try {
    const state = await connection.call('playerState', [{ presentationVersion: 1 }]);
    if (state.publicScene?.version !== 1)
      throw new Error(
        'The host does not provide the interactive player snapshot. Update the host before playing.'
      );
    validatePlayerState(state);
    resources ??= (await loadBundledResources()).resources;
    const catalog = await resources.catalog(state.campaign);
    app = new PlayerGameApplication({
      gameManager,
      connection,
      identity,
      catalog,
      initialState: state,
      openSheet,
    });
    app.resources = resources;
    gameManager.playerApplication = app;
    gameManager.campaignContext = gameManager.characterServices;
    gameManager.campaign = state.campaign;
    return app;
  } catch (error) {
    if (app) await app.destroy();
    else {
      connection.close();
      resources?.close();
    }
    throw error;
  }
}
