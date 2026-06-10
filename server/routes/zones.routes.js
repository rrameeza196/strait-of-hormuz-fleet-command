import { Router } from 'express';

/**
 * @param {{
 *   getZonesPayload: () => unknown[];
 *   addRestrictedZone: (feature: any) => string;
 *   removeRestrictedZone: (zoneId: string) => boolean;
 * }} simulator
 */
export function createZonesRouter(simulator) {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(simulator.getZonesPayload());
  });

  router.post('/', (req, res) => {
    const feature = req.body;
    if (
      !feature ||
      feature.type !== 'Feature' ||
      feature.geometry?.type !== 'Polygon'
    ) {
      res.status(400).json({ error: 'Invalid GeoJSON Polygon Feature.' });
      return;
    }

    const id = simulator.addRestrictedZone(feature);
    res.status(201).json({ id });
  });

  router.delete('/:id', (req, res) => {
    const removed = simulator.removeRestrictedZone(req.params.id);
    if (!removed) {
      res.status(404).json({ ok: false, error: 'zone not found' });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
