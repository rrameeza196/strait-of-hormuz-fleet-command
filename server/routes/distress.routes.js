import { Router } from 'express';

export function createDistressRouter(geminiService, io, simulator) {
  const router = Router();

  router.get('/probe', (_req, res) =>
    res.json({ status: 'distress route active' })
  );

  router.post('/', async (req, res) => {
    try {
      const { shipId, message } = req.body ?? {};
      const result = await geminiService.analyzeDistressMessage(message);
      const timestamp = result.timestamp || new Date().toISOString();
      const payload = {
        shipId: shipId ?? null,
        ...result,
        timestamp,
        at: Date.now(),
      };
      if (shipId) {
        simulator?.registerDistressAlert(shipId, result);
      }
      io?.emit('new-distress-alert', payload);
      return res.json({
        ok: true,
        ...payload,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error.message || 'Failed to process distress message',
      });
    }
  });

  return router;
}
