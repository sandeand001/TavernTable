export function removeToken(c, token) {
  token.creature.removeFromStage();
  c.placedTokens = c.placedTokens.filter(t => t !== token);
}
