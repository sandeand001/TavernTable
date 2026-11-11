export function openTraversalDoors(world) {
  for (const connection of world.getConnections()) {
    if (connection.kind !== 'door') continue;
    if (connection.locked)
      throw new Error('Traversal fixtures must explicitly unlock a locked door');
    if (!connection.open) world.setDoorState(connection.id, { open: true });
  }
  return world;
}
