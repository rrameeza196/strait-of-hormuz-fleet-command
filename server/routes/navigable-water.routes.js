import { Router } from 'express';

/**
 * @param {{
 *   _id?: string;
 *   name?: string;
 *   polygon: { type: 'Polygon'; coordinates: number[][][] };
 *   boundingBox?: { north?: number; south?: number; east?: number; west?: number };
 * }} navigableWater
 */
export function createNavigableWaterRouter(navigableWater) {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({
      type: 'Feature',
      geometry: navigableWater.polygon,
      properties: {
        id: navigableWater._id,
        name: navigableWater.name,
        boundingBox: navigableWater.boundingBox ?? null,
      },
    });
  });

  return router;
}
