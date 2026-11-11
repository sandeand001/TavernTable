import { targetingBoard } from '../coordinators/TargetingBoard.js';
import { targetingAvailability, validateTargetSelection } from '../rules/targeting/assessment.js';
import { playerCreatureVisibility } from './CreatureVisibility.js';
import { collectCollisionObstacles } from '../systems/dice/DicePhysics.js';
import { gameplayError } from './ServerGameplay.js';

export default class ServerTargeting {
  constructor({ runtime, scene, library, actor, ownedIds }) {
    this.runtime = runtime;
    this.scene = scene;
    this.actor = actor;
    this.ownedIds = new Set(ownedIds);
    const map = runtime.world.getMap(actor.mapId);
    this.map = map;
    this.gm = {
      campaignWorld: runtime.world,
      campaignMapId: actor.mapId,
      placedTokens: runtime.actors,
      spatial: { tileWorldSize: map.grid.tileWorldSize },
      terrainEngine: { geometry: runtime.world.getMapGeometry(actor.mapId) },
      characterServices: { library, combat: runtime.combat },
    };
  }

  beginQuery() {
    this.cachedBoard = null;
  }

  board() {
    return (this.cachedBoard ||= targetingBoard(this.gm));
  }

  hasTokenId(id, characterId = null) {
    return this.runtime.actors.some(
      (actor) => actor.id === id && (characterId === null || actor.characterSheetId === characterId)
    );
  }

  actorFor(token, action, board) {
    const actor = board.tokens.find((entry) => entry.id === token.id);
    return action.spellEffectId ? { ...actor, world: { ...action.effectOrigin } } : actor;
  }

  availability(token, action) {
    if (!action.targeting) return { allowed: true, reason: '', candidates: [] };
    const board = this.board();
    const visible = new Set(this.visible().map((entry) => entry.id));
    return targetingAvailability(
      { ...board, tokens: board.tokens.filter((entry) => visible.has(entry.id)) },
      this.actorFor(token, action, board),
      action.targeting
    );
  }

  visible() {
    return playerCreatureVisibility({
      world: this.runtime.world,
      creatures: this.scene.creatures.map((entry) => ({
        ...entry,
        mapId: this.scene.version === 3 ? entry.mapId : 'map-main',
      })),
      ownedIds: [...this.ownedIds],
      publishedIds: this.runtime.world.listMaps().map((entry) => entry.id),
      observerTokenId: this.actor.id,
    }).visible;
  }

  validate(token, action, selection) {
    this.beginQuery();
    const visible = new Set(this.visible().map((entry) => entry.id));
    if (
      (selection?.targets || []).some((entry) => !visible.has(entry.tokenId)) ||
      (selection?.exclusions || []).some((id) => !visible.has(id))
    )
      throw gameplayError('The selected target is not available', 'target-unavailable');
    const board = this.board();
    const selected = validateTargetSelection(
      board,
      this.actorFor(token, action, board),
      action.targeting,
      action.targeting.requiresWilling ? { ...selection, willingConfirmed: true } : selection
    );
    if (
      action.targeting.requiresWilling &&
      selected.targets.some(
        (target) =>
          target.tokenId !== token.id &&
          this.runtime.actors.find((entry) => entry.id === target.tokenId)?.allegiance === 'hostile'
      )
    )
      throw gameplayError('Hostile targets are not assumed willing', 'target-unwilling');
    return selected;
  }

  rollContext() {
    const map = this.map;
    const projected = this.visible().map((entry) => {
      const point = this.runtime.world.projectCreature(entry.id, this.actor.mapId).world;
      return {
        gridX: Math.floor(point.x / map.grid.tileWorldSize),
        gridY: Math.floor(point.z / map.grid.tileWorldSize),
      };
    });
    return {
      metrics: { cols: map.grid.cols, rows: map.grid.rows, tileSize: map.grid.tileWorldSize },
      groundHeights: map.terrain.heights.map((row) =>
        row.map((height) => height * map.terrain.worldElevationUnit)
      ),
      obstacles: collectCollisionObstacles(
        {
          gameManager: {
            placedTokens: projected,
            spatial: {
              tileWorldSize: map.grid.tileWorldSize,
              gridToWorld: (x, z) => ({
                x: x * map.grid.tileWorldSize,
                z: z * map.grid.tileWorldSize,
              }),
            },
          },
        },
        { tileSize: map.grid.tileWorldSize }
      ),
    };
  }
}
