import { Router } from 'express';

/**
 * @param {{ identifyDarkThreat: (threatId: string, gemini: import('../services/GeminiService.js').GeminiService) => Promise<{ ok: boolean; error?: string; aiLabel?: string }> }} simulator
 * @param {import('../services/GeminiService.js').GeminiService} geminiService
 */
export function createThreatsRouter(simulator, geminiService) {
  const router = Router();

  router.post('/:threatId/identify', async (req, res) => {
    try {
      const result = await simulator.identifyDarkThreat(req.params.threatId, geminiService);
      if (!result.ok) {
        return res.status(400).json(result);
      }
      return res.json({ ok: true, aiLabel: result.aiLabel });
    } catch (error) {
      console.error('[Threats] identify failed:', error);
      return res.status(500).json({ ok: false, error: error.message || 'identify failed' });
    }
  });

  return router;
}
