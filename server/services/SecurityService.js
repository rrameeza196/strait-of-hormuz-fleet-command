import * as turf from '@turf/turf';

/** Radar / tier thresholds (km, great-circle). */
export const DETECTION_RADIUS_KM = 10;
export const CAUTION_RADIUS_KM = 5;
export const THREAT_RADIUS_KM = 2;

/**
 * @typedef {{ shipId: string; lng: number; lat: number }} FriendlyShip
 * @typedef {{ threatId: string }} DarkVesselLike
 */

/**
 * Minimum distance from dark vessel to any friendly ship (km).
 * @param {FriendlyShip[]} friendlies
 * @param {number} lng
 * @param {number} lat
 */
export function minDistanceToFleetKm(friendlies, lng, lat) {
  const pt = turf.point([lng, lat]);
  let min = Infinity;
  let closestId = null;
  for (const s of friendlies) {
    const d = turf.distance(pt, turf.point([s.lng, s.lat]), { units: 'kilometers' });
    if (d < min) {
      min = d;
      closestId = s.shipId;
    }
  }
  return { minDistanceKm: Number.isFinite(min) ? min : null, closestFriendlyShipId: closestId };
}

export function tierFromDistanceKm(distanceKm) {
  if (distanceKm == null || !Number.isFinite(distanceKm)) return 0;
  if (distanceKm <= THREAT_RADIUS_KM) return 3;
  if (distanceKm <= CAUTION_RADIUS_KM) return 2;
  if (distanceKm <= DETECTION_RADIUS_KM) return 1;
  return 0;
}

/**
 * Evaluate proximity tiers for all dark vessels vs friendly RAM ships.
 * @param {FriendlyShip[]} friendlyShips
 * @param {DarkVesselLike[]} darkVessels — must have lng, lat on each for runtime
 */
export function evaluateThreatExposure(friendlyShips, darkVessels) {
  return darkVessels.map((dv) => {
    const { minDistanceKm, closestFriendlyShipId } = minDistanceToFleetKm(
      friendlyShips,
      dv.lng,
      dv.lat
    );
    const tier = tierFromDistanceKm(minDistanceKm);
    return {
      threatId: dv.threatId,
      minDistanceKm,
      closestFriendlyShipId,
      tier,
    };
  });
}
