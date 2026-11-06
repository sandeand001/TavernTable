const town = Object.freeze({
  kind: 'town',
  cols: 35,
  rows: 35,
  structures: 16,
  volumes: 800,
  floorMaps: 40,
});
const city = Object.freeze({
  kind: 'city',
  cols: 45,
  rows: 45,
  structures: 32,
  volumes: 1200,
  floorMaps: 96,
});
const castle = Object.freeze({
  kind: 'castle',
  cols: 50,
  rows: 50,
  structures: 20,
  volumes: 1100,
  floorMaps: 64,
});
const profiles = Object.freeze({
  town,
  city,
  castle,
  cliffsideCastle: Object.freeze({ ...castle, cols: 60, rows: 60, site: 'cliff' }),
  mountainCastle: Object.freeze({ ...castle, cols: 60, rows: 60, site: 'mountain' }),
  ruinedTown: town,
  ruinedUrban: city,
  ruinedCastle: castle,
});
const natural = Object.freeze({ structures: 8, volumes: 220, floorMaps: 16 });

export function getSettlementProfile(biomeKey) {
  return Object.hasOwn(profiles, biomeKey) ? profiles[biomeKey] : null;
}

export function getBiomeStructureBudget(biomeKey) {
  return getSettlementProfile(biomeKey) ?? natural;
}
