import axios from 'axios';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

/** `gemini` (default) or `xai` / `grok` for xAI Grok chat completions. */
function normalizeLlmProvider(raw) {
  const v = String(raw || 'gemini').trim().toLowerCase();
  if (v === 'xai' || v === 'grok') return 'xai';
  return 'gemini';
}

const XAI_CHAT_URL = 'https://api.x.ai/v1/chat/completions';
const MODEL_CANDIDATES = [
  GEMINI_MODEL,
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash-latest',
  'gemini-1.5-flash-8b',
  'gemini-1.5-flash',
];
const AVAILABLE_PORTS = ['Muscat', 'Salalah', 'Doha', 'Abu Dhabi', 'Fujairah'];
const SUPPORT_VESSELS = ['Tug Alpha', 'MedEvac-1', 'Coast Guard Patrol 7'];

const WORD_TO_NUM = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const SEVERITY_RANK = { low: 0, medium: 1, high: 2 };

/** True if narrative implies the ship cannot reach port safely under own power (tow/medevac context). */
export function distressCannotProceedUnderOwnPower(rawMessage) {
  const message = String(rawMessage || '').toLowerCase();
  const vesselDisabled =
    /\bstopped\b|\bstoped\b|\bdead\s+in\s+water\b|\bnot\s+underway\b|\bunable\s+to\s+maneuver\b|\badrift\b|\bdisabled\b|\bimmobil(?:e|i[sz]ed)?\b/i.test(
      message
    );
  const propulsionLost =
    /\bengine\b(?:s)?\s+(?:failed|lost|dead|down)\b|\bfailed\s+engine\b|\bengines?\s+down\b|\bloss\s+of\s+propulsion\b|\bblackout\b|\bno\s+(?:engine\s+)?power\b|\bout\s+of\s+fuel\b/.test(
      message
    );
  return vesselDisabled || propulsionLost;
}

function llmCoversLossOfPropulsionAction(text) {
  const s = String(text || '').toLowerCase();
  return /\btug\b|\btow\b|towage|salvage|medevac|aeromedical|helicopter|rescue\s+vessel|sar\b|cannot\s+(?:proceed|sail)|dead\s+in\s+water|under\s+tow|dispatch\s+support/.test(
    s
  );
}

/**
 * Rule-based distress classification when Gemini is unavailable or fails (quota/network).
 * Covers wording like "injured" (not just "injury") and word numbers ("three people").
 */
export function heuristicDistressAnalysis(rawMessage) {
  const message = String(rawMessage || '').toLowerCase();

  let injuries = 0;

  const digitPeople = message.match(
    /\b(\d+)\s*(people|persons?|crew|passengers?)\b(?:\s+(?:were\s+)?(?:injured|hurt|wounded))?/
  );
  if (digitPeople) injuries = Math.max(injuries, parseInt(digitPeople[1], 10));

  const digitCrew = message.match(/\b(\d+)\s+crew\b(?:\s+(?:were\s+)?(?:injured|hurt|wounded))?/);
  if (digitCrew) injuries = Math.max(injuries, parseInt(digitCrew[1], 10));

  const wordPeople = message.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+people\b(?:\s+(?:were\s+)?(?:injured|hurt|wounded))?/
  );
  if (wordPeople && WORD_TO_NUM[wordPeople[1]]) {
    injuries = Math.max(injuries, WORD_TO_NUM[wordPeople[1]]);
  }

  const medicalSignals =
    /\binjured\b|\binjuries\b|\binjury\b|\bhurt\b|\bbleeding\b|\bcasualt|\bmedical\b|\bevac\b|\bunconscious\b|\bmortal\b|\bcardiac\b|\babdominal\b/.test(
      message
    );
  if (medicalSignals) injuries = Math.max(injuries, 1);

  const mechanicalSignals =
    /\bengine\b|\bengines\b|\bpower\s+lost\b|\bblackout\b|\bsteering\b|\brudder\b|\bpropulsion\b|\bmechanical\b|\bbroken\s+down\b|\bmachinery\b|\bstalled\b/.test(
      message
    );

  const vesselDisabled =
    /\bstopped\b|\bstoped\b|\bdead\s+in\s+water\b|\bnot\s+underway\b|\bunable\s+to\s+maneuver\b|\badrift\b|\bdisabled\b|\bimmobil(?:e|i[sz]ed)?\b/i.test(
      message
    );

  const urgentSignals =
    /\bmayday\b|\bpan\s*-?\s*pan\b|\bemergency\b|\bcritical\b|\bsinking\b|\bflooding\b|\bfire\b|\babandon\s+ship\b|\bcapsiz|\bcollision\b|\bstruck\b|\bsos\b/.test(
      message
    );

  const isHigh =
    urgentSignals ||
    injuries >= 2 ||
    (medicalSignals && (mechanicalSignals || vesselDisabled)) ||
    (mechanicalSignals && vesselDisabled);

  const severity = isHigh ? 'high' : mechanicalSignals || vesselDisabled || medicalSignals ? 'medium' : 'low';

  let type = 'general';
  if (medicalSignals && mechanicalSignals) type = 'medical_mechanical';
  else if (medicalSignals) type = 'medical';
  else if (mechanicalSignals) type = 'mechanical';

  const needsEscort = isHigh || medicalSignals || injuries >= 1 || urgentSignals;

  const propulsionLost = distressCannotProceedUnderOwnPower(rawMessage);

  let summary = 'Distress reported by vessel';
  if (medicalSignals && mechanicalSignals) {
    summary = propulsionLost
      ? 'Medical casualties reported; vessel likely unable to proceed under own power'
      : 'Medical casualties reported with propulsion or machinery impairment';
  } else if (medicalSignals) {
    summary = 'Medical distress reported by crew';
  } else if (mechanicalSignals) {
    summary = propulsionLost
      ? 'Machinery distress — vessel likely stopped or without usable propulsion'
      : 'Operational / machinery distress reported by vessel';
  }

  let suggestedAction = 'Dispatch Tug Alpha and continue close monitoring.';
  if (medicalSignals && propulsionLost) {
    suggestedAction =
      'Declare emergency traffic as warranted. Do not assume self-propulsion — dispatch Tug Alpha (or nearest salvage tug) for tow. Casualties: MedEvac-1 / helicopter medevac to shore hospital; coordinate nearest suitable trauma port (Muscat, Fujairah, Abu Dhabi per range). Coast Guard coordination.';
  } else if (medicalSignals) {
    suggestedAction =
      'MedEvac-1 standby; shape course toward nearest port with trauma/medical reception (Muscat / Fujairah / Abu Dhabi per proximity); Coast Guard coordination.';
  } else if (propulsionLost || vesselDisabled) {
    suggestedAction =
      'Dispatch tug for tow — vessel cannot reliably proceed independently. Tow toward nearest repair anchorage / port (Fujairah / Muscat per SAR planner); Coast Guard escort if needed in confined waters.';
  } else if (mechanicalSignals) {
    suggestedAction =
      'Reduce speed; engineering assessment; standby tug if deterioration; divert toward nearest support port if risk increases.';
  } else if (isHigh) {
    suggestedAction = 'Close monitoring; coordinate nearest support station and fleet assets.';
  }

  return {
    severity,
    type,
    summary,
    injuries,
    needsEscort,
    suggestedAction,
  };
}

function mergeSeverity(a, b) {
  const ra = SEVERITY_RANK[a] ?? 1;
  const rb = SEVERITY_RANK[b] ?? 1;
  return ra >= rb ? a : b;
}

export class GeminiService {
  constructor() {
    this.provider = normalizeLlmProvider(process.env.LLM_PROVIDER);
    this.apiKey = process.env.GEMINI_API_KEY || '';
    this.xaiKey = process.env.XAI_API_KEY || '';
    this.activeModel = null;
  }

  llmConfigured() {
    if (this.provider === 'xai') return Boolean(this.xaiKey.trim());
    return Boolean(this.apiKey.trim());
  }

  /**
   * @returns {{ text: string; sourceLabel: string }}
   */
  async llmGenerate(prompt, timeoutMs = 12000) {
    if (this.provider === 'xai') {
      if (!this.xaiKey.trim()) {
        throw new Error('missing_xai_api_key');
      }
      const model = process.env.XAI_MODEL || 'grok-3-mini-latest';
      const { data } = await axios.post(
        XAI_CHAT_URL,
        {
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
        },
        {
          headers: {
            Authorization: `Bearer ${this.xaiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: timeoutMs,
        }
      );
      const text = String(data?.choices?.[0]?.message?.content ?? '').trim();
      return { text, sourceLabel: `${model}-xai` };
    }

    if (!this.apiKey.trim()) {
      throw new Error('missing_gemini_api_key');
    }

    const modelToUse = await this.resolveModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent?key=${this.apiKey}`;
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    };
    const { data } = await axios.post(url, body, { timeout: timeoutMs });
    const text = String(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
    return { text, sourceLabel: modelToUse };
  }

  async resolveModel() {
    if (this.activeModel) return this.activeModel;
    if (!this.apiKey) return GEMINI_MODEL;

    try {
      const { data } = await axios.get(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`,
        { timeout: 10000 }
      );
      const available = Array.isArray(data?.models) ? data.models : [];
      const supportsGenerate = available
        .filter((m) => (m?.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => String(m.name || '').replace(/^models\//, ''));

      for (const candidate of MODEL_CANDIDATES) {
        if (supportsGenerate.includes(candidate)) {
          this.activeModel = candidate;
          console.log('Gemini model selected:', this.activeModel);
          return this.activeModel;
        }
      }

      const firstFlash = supportsGenerate.find((m) => /flash/i.test(m));
      if (firstFlash) {
        this.activeModel = firstFlash;
        console.log('Gemini model selected:', this.activeModel);
        return this.activeModel;
      }

      this.activeModel = supportsGenerate[0] || GEMINI_MODEL;
      console.log('Gemini model selected:', this.activeModel);
      return this.activeModel;
    } catch (error) {
      console.error('Gemini model discovery failed:', error.message);
      this.activeModel = GEMINI_MODEL;
      return this.activeModel;
    }
  }

  async analyzeDistressMessage(message) {
    if (!message?.trim()) {
      return {
        severity: 'low',
        type: 'unknown',
        summary: 'No distress content provided',
        injuries: 0,
        needsEscort: false,
        suggestedAction: 'Continue monitoring and maintain current route.',
        timestamp: new Date().toISOString(),
        source: 'local-fallback',
      };
    }

    const heuristic = heuristicDistressAnalysis(message);

    if (!this.llmConfigured()) {
      const fallback = {
        ...heuristic,
        timestamp: new Date().toISOString(),
        source: 'local-fallback',
      };
      console.log(
        `Distress analysis (${this.provider === 'xai' ? 'no XAI_API_KEY' : 'no GEMINI_API_KEY'}, heuristic):`,
        fallback
      );
      return fallback;
    }

    const prompt = `You are a maritime emergency dispatcher. Analyze the following message and return ONLY a valid JSON object. Do not include markdown formatting or extra text.
Available Ports: ${AVAILABLE_PORTS.join(', ')}.
Support Vessels: ${SUPPORT_VESSELS.join(', ')}.
If distress indicates Mechanical Failure, Out of Fuel, or Medical Emergency, suggestedAction must be operationally realistic.

Rules for suggestedAction:
- If the vessel cannot proceed under own power (engine failure, stopped / dead in water, loss of propulsion, blackout), you MUST mention dispatching a tug/tow or salvage — do NOT imply the ship can simply "sail" or "redirect" to port alone.
- If there are injuries or medical emergency, mention MedEvac/helicopter/coastal medevac as appropriate together with nearest suitable port.
- If both apply, combine tug/tow + medical evacuation + Coast Guard coordination.

Schema: { "severity": "low" | "medium" | "high", "type": string, "summary": string, "injuries": number, "needsEscort": boolean, "suggestedAction": string }.

Message:
${message}`;
    console.log(`Distress LLM prompt (${this.provider}):`, prompt);

    try {
      const { text: rawText, sourceLabel } = await this.llmGenerate(prompt, 12000);
      console.log('Distress LLM raw text:', rawText);
      const stripped = rawText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      const parsed = JSON.parse(stripped);
      const parsedSeverity = ['low', 'medium', 'high'].includes(parsed?.severity)
        ? parsed.severity
        : 'medium';
      const injuriesParsed = Number.isFinite(Number(parsed?.injuries))
        ? Number(parsed.injuries)
        : 0;

      const severity = mergeSeverity(parsedSeverity, heuristic.severity);
      const injuries = Math.max(injuriesParsed, heuristic.injuries);
      const needsEscort = Boolean(parsed?.needsEscort) || heuristic.needsEscort;

      let type = String(parsed?.type || 'general');
      let summary = String(parsed?.summary || 'Distress reported');
      let suggestedAction = String(
        parsed?.suggestedAction || 'Redirect to Muscat for immediate assistance.'
      );

      if (SEVERITY_RANK[heuristic.severity] > SEVERITY_RANK[parsedSeverity]) {
        type = heuristic.type;
        summary = heuristic.summary;
        suggestedAction = heuristic.suggestedAction;
      }

      if (
        distressCannotProceedUnderOwnPower(message) &&
        !llmCoversLossOfPropulsionAction(suggestedAction)
      ) {
        suggestedAction = heuristic.suggestedAction;
      }

      return {
        severity,
        type,
        summary,
        injuries,
        needsEscort,
        suggestedAction,
        timestamp: new Date().toISOString(),
        source: sourceLabel,
      };
    } catch (error) {
      const status = error?.response?.status;
      const responseBody = error?.response?.data;
      console.error('Distress LLM request failed:', status || error.message, responseBody);
      const errStr =
        typeof responseBody?.error === 'string'
          ? responseBody.error
          : JSON.stringify(responseBody || {});
      if (this.provider === 'xai' && status === 400 && /incorrect api key|invalid api key/i.test(errStr)) {
        console.warn(
          '[Distress] xAI rejected XAI_API_KEY (use a key from https://console.x.ai — a Google/Gemini key will not work). Using rule-based classification.'
        );
      } else if (status === 429) {
        console.warn('[Distress] Using rule-based classification (LLM quota or rate limit).');
      } else if (!status || status >= 500) {
        console.warn('[Distress] Using rule-based classification (LLM error).');
      }
      return {
        ...heuristic,
        timestamp: new Date().toISOString(),
        source: 'local-fallback-after-error',
      };
    }
  }

  /**
   * Dark-vessel / AIS spoofing classification for operator identification workflow.
   * @param {{ proximityKm?: number; speedKnots?: number; tier?: number; behavior?: string }} ctx
   */
  async analyzeThreatSignature(ctx) {
    const proximityKm = Number(ctx?.proximityKm ?? 0);
    const speedKnots = Number(ctx?.speedKnots ?? 0);
    const tier = Number(ctx?.tier ?? 1);
    const behavior = String(ctx?.behavior ?? 'unknown');

    if (!this.llmConfigured()) {
      const classification =
        tier >= 3
          ? 'Likely hostile fast craft — intercept recommended'
          : behavior === 'stationary'
            ? 'Non-AIS fishing trawler or anchored dhow'
            : 'Suspected pirate skiff — erratic AIS-null track';
      console.log('Threat signature (fallback):', classification);
      return { classification, source: 'local-fallback' };
    }

    const prompt = `You are a maritime security analyst. An unidentified radar contact shows AIS spoofing / no identity.
Closest range to friendly traffic: ${proximityKm.toFixed(2)} km.
Observed speed: ${speedKnots.toFixed(1)} knots.
Track behavior: ${behavior}.
Alert tier: ${tier} (1=radar detection fringe, 2=caution, 3=threat proximity).

Return ONLY valid JSON, no markdown:
{ "classification": "<concise label e.g. Likely Pirate Skiff or Non-AIS Fishing Trawler>" }
classification max 90 characters.`;

    try {
      const { text: rawText, sourceLabel } = await this.llmGenerate(prompt, 12000);
      const stripped = rawText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      const parsed = JSON.parse(stripped);
      const classification = String(parsed?.classification || 'Unidentified surface contact').slice(
        0,
        120
      );
      console.log('Threat signature LLM:', classification);
      return { classification, source: sourceLabel };
    } catch (error) {
      console.error('Threat signature LLM failed:', error?.message || error);
      return {
        classification:
          tier >= 3
            ? 'High-risk unidentified vessel — treat as hostile until classified'
            : 'Small craft — probable non-compliant fishing or logistics tender',
        source: 'local-fallback-after-error',
      };
    }
  }
}
