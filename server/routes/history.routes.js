import { Router } from 'express';

/**
 * @param {{ getHistorySnapshots: () => unknown[] }} simulator
 */
export function createHistoryRouter(simulator) {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(simulator.getHistorySnapshots());
  });

  return router;
}
