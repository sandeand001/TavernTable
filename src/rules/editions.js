const EDITIONS = Object.freeze({
  2014: Object.freeze({ id: '2014', name: '2014', srd: '5.1', corePack: 'srd-2014' }),
  2024: Object.freeze({ id: '2024', name: '2024', srd: '5.2.1', corePack: 'srd-2024' }),
});

export function edition(id) {
  if (!Object.hasOwn(EDITIONS, id)) throw new Error('Choose a supported campaign ruleset');
  return EDITIONS[id];
}

export const supportedEditions = Object.freeze(Object.values(EDITIONS));
