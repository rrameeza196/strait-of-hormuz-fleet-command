import * as turf from '@turf/turf';
import axios from 'axios';
import Ship from '../models/Ship.js';
import { evaluateThreatExposure } from './SecurityService.js';

const TICK_MS = 1000;
/** Align polling with cache TTL so we do not schedule needless refreshes. */
const WEATHER_REFRESH_MS = 10 * 60 * 1000;
const PROXIMITY_KM = 2;
const OPEN_METEO_MIN_INTERVAL_MS = 1000;
const OPEN_METEO_CACHE_TTL_MS = 10 * 60 * 1000;
const OPEN_METEO_429_RETRY_DELAY_MS = 5000;
/** Initial attempt plus up to three retries after HTTP 429. */
const OPEN_METEO_MAX_ATTEMPTS_ON_429 = 4;
const MS_TO_KNOTS = 1.9438444924406;
const DEFAULT_WEATHER = {
  wind: 15,
  waves: 1,
};

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildWeatherUrl() {
  const latitude = num(process.env.WEATHER_LATITUDE, 26.0);
  const longitude = num(process.env.WEATHER_LONGITUDE, 55.0);
  const requested =
    process.env.WEATHER_CURRENT_PARAMS ||
    'wind_speed_10m,wind_direction_10m,wind_gusts_10m,wave_height';
  const windUnit = process.env.WEATHER_WIND_SPEED_UNIT || 'ms';
  const params = encodeURIComponent(requested);
  const unitParam = encodeURIComponent(windUnit);
  return `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=${params}&wind_speed_unit=${unitParam}`;
}

function openMeteoCacheKeyFromUrl(url) {
  return url;
}

/**
 * Wind from API is converted to knots for existing simulator / UI thresholds.
 * Wave height may be absent from current params at some coordinates — keep previous when missing.
 */
function normalizeOpenMeteoCurrent(data, previousWavesFallback) {
  const windMs = num(data?.current?.wind_speed_10m, NaN);
  const wind = Number.isFinite(windMs) ? windMs * MS_TO_KNOTS : DEFAULT_WEATHER.wind;
  const waveRaw = data?.current?.wave_height;
  const waves = Number.isFinite(Number(waveRaw))
    ? Number(waveRaw)
    : Number.isFinite(Number(previousWavesFallback))
      ? Number(previousWavesFallback)
      : DEFAULT_WEATHER.waves;
  return { wind, waves };
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * @param {import('mongoose').Document | object} doc
 */
function docToRamShip(doc) {
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const [lng, lat] = o.location.coordinates;
  const baseSpeed = Number(o.baseSpeed ?? o.speed ?? 0);
  return {
    shipId: o.shipId,
    name: o.name,
    lng,
    lat,
    speed: baseSpeed,
    baseSpeed,
    heading: o.heading,
    destination: o.destination,
    fuel: o.fuel,
    cargo: o.cargo,
    type: o.type || 'cargo',
    status: o.status,
    envDrag: 0,
    envDragKnots: 0,
    fuelConsumptionTick: 0,
    distress: null,
    _prevStatus: o.status,
  };
}

function ramToPayload(s) {
  return {
    shipId: s.shipId,
    name: s.name,
    position: [s.lat, s.lng],
    speed: s.speed,
    baseSpeed: s.baseSpeed,
    effectiveSpeed: s.speed,
    envDrag: s.envDrag,
    envDragKnots: s.envDragKnots,
    fuelConsumptionTick: s.fuelConsumptionTick,
    distress: s.distress,
    heading: s.heading,
    destination: s.destination,
    fuel: s.fuel,
    cargo: s.cargo,
    type: s.type || 'cargo',
    status: s.status,
  };
}

/**
 * @param {number} lng
 * @param {number} lat
 * @param {number} headingDeg
 * @param {number} speedKnots
 */
function moveByHeading(lng, lat, headingDeg, speedKnots) {
  const point = turf.point([lng, lat]);
  const distanceNm = speedKnots / 3600;
  const next = turf.destination(point, distanceNm, headingDeg, {
    units: 'nauticalmiles',
  });
  const [nextLng, nextLat] = next.geometry.coordinates;
  return [nextLng, nextLat];
}

function normalizeHeading(h) {
  const mod = h % 360;
  return mod < 0 ? mod + 360 : mod;
}

/** @param {{ threatId: string; position: [number, number]; speed?: number; heading?: number; behavior?: string; seedPhase?: number }} row */
function initDarkVesselRow(row) {
  const [lat, lng] = row.position;
  return {
    threatId: row.threatId,
    lat,
    lng,
    heading: row.heading ?? 0,
    baseSpeed: row.speed ?? 8,
    speed: row.speed ?? 8,
    behavior: row.behavior === 'stationary' ? 'stationary' : 'erratic',
    phase: row.seedPhase ?? Math.random() * Math.PI * 2,
    identified: false,
    aiLabel: null,
    tier: 0,
    minDistanceKm: null,
    closestFriendlyShipId: null,
  };
}

export class Simulator {
  /**
   * @param {{
   *   io: import('socket.io').Server;
   *   navigable: import('geojson').Polygon | import('geojson').Feature<import('geojson').Polygon>;
   *   ships: ReturnType<typeof docToRamShip>[];
   *   portsById?: Record<string, { lng: number; lat: number }>;
   *   shadowFleetConfig?: { shadowFleet?: unknown[] } | null;
   * }} params
   */
  constructor({ io, navigable, ships, portsById = {}, shadowFleetConfig = null }) {
    this.io = io;
    this.navigable = navigable;
    this.ships = ships;
    this.portsById = portsById;
    this.darkVessels =
      Array.isArray(shadowFleetConfig?.shadowFleet) && shadowFleetConfig.shadowFleet.length > 0
        ? shadowFleetConfig.shadowFleet.map((row) => initDarkVesselRow(row))
        : [];
    /** @type {ReturnType<typeof setInterval> | null} */
    this.intervalId = null;
    /** @type {ReturnType<typeof setInterval> | null} */
    this.weatherIntervalId = null;
    this.running = false;
    this.fuelBurnTonsPerKnotHour = num(
      process.env.FUEL_BURN_TONS_PER_KNOT_HOUR,
      2.5
    );
    this.globalWeather = {
      wind: DEFAULT_WEATHER.wind,
      waves: DEFAULT_WEATHER.waves,
      updatedAt: null,
      source: 'default',
      lastSuccessfulSync: null,
    };
    /** @type {{ id: string; feature: import('geojson').Feature<import('geojson').Polygon> }[]} */
    this.restrictedZones = [];
    this.lastAdvisorByShip = new Map();

    /** ~30s cadence snapshots for playback API (cap 120 ≈ 1 h). */
    this.tickCounter = 0;
    /** @type {{ recordedAt: number; iso: string; ships: unknown[]; zones: unknown[]; threats: unknown[]; weather: unknown }[]} */
    this.historySnapshots = [];

    /** Prevent overlapping Open-Meteo requests (e.g. start() + interval). */
    this._weatherFetchInFlight = false;
    /** Timestamp (ms) of last finished HTTP request to Open-Meteo (success or error). */
    this._lastOpenMeteoHttpAt = 0;
    /** @type {{ key: string; expiresAt: number; payload: { wind: number; waves: number }; syncedAtIso: string } | null} */
    this._openMeteoCache = null;
  }

  /** @param {import('mongoose').Document[]} shipDocs */
  static fromDocuments(shipDocs) {
    return shipDocs.map((d) => docToRamShip(d));
  }

  getFleetPayload() {
    return this.ships.map(ramToPayload);
  }

  getWeatherPayload() {
    return {
      wind: this.globalWeather.wind,
      waves: this.globalWeather.waves,
      updatedAt: this.globalWeather.updatedAt,
      source: this.globalWeather.source,
      lastSuccessfulSync: this.globalWeather.lastSuccessfulSync,
    };
  }

  getZonesPayload() {
    return this.restrictedZones.map((z) => ({
      id: z.id,
      ...z.feature,
    }));
  }

  getThreatPayload() {
    return this.darkVessels.map((dv) => ({
      threatId: dv.threatId,
      position: [dv.lat, dv.lng],
      speed: dv.speed,
      heading: dv.heading,
      tier: dv.tier,
      distanceKm: dv.minDistanceKm,
      closestFriendlyShipId: dv.closestFriendlyShipId,
      identified: dv.identified,
      aiLabel: dv.aiLabel || null,
      behavior: dv.behavior,
    }));
  }

  broadcastFleetUpdate() {
    this.io.emit('fleet-update', {
      ships: this.getFleetPayload(),
      threats: this.getThreatPayload(),
      weather: this.getWeatherPayload(),
      zones: this.getZonesPayload(),
    });
  }

  tickDarkVessels() {
    for (const dv of this.darkVessels) {
      if (dv.behavior === 'stationary') {
        dv.speed = 0;
        dv.phase += 0.015;
        continue;
      }

      dv.phase += 0.06 + Math.random() * 0.03;
      const turn = Math.sin(dv.phase) * 24 + (Math.random() - 0.5) * 12;
      dv.heading = normalizeHeading(dv.heading + turn);
      dv.speed = Math.max(
        3,
        Math.min(15, dv.baseSpeed + Math.sin(dv.phase * 1.37) * 4 + (Math.random() - 0.5) * 2)
      );

      const [nextLng, nextLat] = moveByHeading(dv.lng, dv.lat, dv.heading, dv.speed);
      if (this.isNavigable(nextLng, nextLat)) {
        dv.lng = nextLng;
        dv.lat = nextLat;
      } else {
        dv.heading = normalizeHeading(dv.heading + 130 + Math.random() * 60);
      }
    }
  }

  /**
   * @param {string} threatId
   * @param {import('./GeminiService.js').GeminiService} geminiService
   */
  async identifyDarkThreat(threatId, geminiService) {
    const dv = this.darkVessels.find((d) => d.threatId === threatId);
    if (!dv) return { ok: false, error: 'threat not found' };
    if (dv.tier < 1) return { ok: false, error: 'contact outside radar envelope' };

    const { classification } = await geminiService.analyzeThreatSignature({
      proximityKm: dv.minDistanceKm,
      speedKnots: dv.speed,
      tier: dv.tier,
      behavior: dv.behavior,
    });

    dv.identified = true;
    dv.aiLabel = classification;
    this.broadcastFleetUpdate();
    return { ok: true, aiLabel: dv.aiLabel };
  }

  addRestrictedZone(feature) {
    const id = `zone-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    this.restrictedZones.push({ id, feature: { ...feature, type: 'Feature' } });
    this.io.emit('zones-updated', this.getZonesPayload());
    return id;
  }

  /** @returns {boolean} */
  removeRestrictedZone(zoneId) {
    const idx = this.restrictedZones.findIndex((z) => z.id === zoneId);
    if (idx === -1) return false;
    this.restrictedZones.splice(idx, 1);
    this.io.emit('zones-updated', this.getZonesPayload());
    this.broadcastFleetUpdate();
    return true;
  }

  getHistorySnapshots() {
    return this.historySnapshots.map((snap, idx) => ({
      idx,
      recordedAt: snap.recordedAt,
      iso: snap.iso,
      ships: snap.ships,
      zones: snap.zones,
      threats: snap.threats,
      weather: snap.weather,
    }));
  }

  /**
   * Captain ACCEPT: snap heading toward assigned destination port (command directive already applied).
   * @returns {Promise<boolean>}
   */
  async captainAcceptCourseToDestination(shipId) {
    const ship = this.ships.find((s) => s.shipId === shipId);
    if (!ship || !Simulator.canMoveStatus(ship.status)) return false;
    const port = this.portsById[ship.destination];
    if (!port) return false;
    ship.heading = normalizeHeading(
      turf.bearing(turf.point([ship.lng, ship.lat]), turf.point([port.lng, port.lat]))
    );
    await Ship.updateOne({ shipId }, { $set: { heading: ship.heading } }).exec();
    this.broadcastFleetUpdate();
    return true;
  }

  registerDistressAlert(shipId, distress) {
    const ship = this.ships.find((s) => s.shipId === shipId);
    if (!ship) return false;
    ship.distress = {
      ...distress,
      active: true,
      updatedAt: new Date().toISOString(),
    };
    return true;
  }

  async updateShipDestination(shipId, destination) {
    const ship = this.ships.find((s) => s.shipId === shipId);
    if (!ship) return false;
    ship.destination = destination;
    await Ship.updateOne({ shipId }, { $set: { destination } }).exec();
    this.broadcastFleetUpdate();
    return true;
  }

  async enforceOpenMeteoMinInterval() {
    const last = this._lastOpenMeteoHttpAt || 0;
    const elapsed = Date.now() - last;
    if (last > 0 && elapsed < OPEN_METEO_MIN_INTERVAL_MS) {
      await sleep(OPEN_METEO_MIN_INTERVAL_MS - elapsed);
    }
  }

  /**
   * Apply wind/waves and optional metadata for logging.
   * @param {{ wind: number; waves: number }} normalized
   * @param {'open-meteo' | 'open-meteo-cache'} source
   * @param {string | null} lastSuccessfulSyncIso
   */
  applyWeatherSnapshot(normalized, source, lastSuccessfulSyncIso) {
    const now = new Date().toISOString();
    console.log('Weather API Sync:', {
      windSpeedKnots: Number(normalized.wind.toFixed(2)),
      waveHeight: normalized.waves,
      fetchedAt: now,
      source,
    });
    this.globalWeather = {
      wind: normalized.wind,
      waves: normalized.waves,
      updatedAt: now,
      source,
      lastSuccessfulSync: lastSuccessfulSyncIso ?? now,
    };
  }

  async refreshWeather() {
    if (this._weatherFetchInFlight) {
      return;
    }
    this._weatherFetchInFlight = true;

    try {
      const url = buildWeatherUrl();
      const cacheKey = openMeteoCacheKeyFromUrl(url);
      const nowMs = Date.now();

      if (
        this._openMeteoCache &&
        this._openMeteoCache.key === cacheKey &&
        nowMs < this._openMeteoCache.expiresAt
      ) {
        const { payload, syncedAtIso } = this._openMeteoCache;
        this.applyWeatherSnapshot(payload, 'open-meteo-cache', syncedAtIso);
        return;
      }

      await this.enforceOpenMeteoMinInterval();

      let lastError = null;
      for (let attempt = 1; attempt <= OPEN_METEO_MAX_ATTEMPTS_ON_429; attempt += 1) {
        try {
          const { data } = await axios.get(url, { timeout: 12000 });
          const normalized = normalizeOpenMeteoCurrent(data, this.globalWeather.waves);
          const syncedAtIso = new Date().toISOString();

          this._openMeteoCache = {
            key: cacheKey,
            expiresAt: Date.now() + OPEN_METEO_CACHE_TTL_MS,
            payload: normalized,
            syncedAtIso,
          };
          this._lastOpenMeteoHttpAt = Date.now();

          this.applyWeatherSnapshot(normalized, 'open-meteo', syncedAtIso);
          return;
        } catch (error) {
          lastError = error;
          this._lastOpenMeteoHttpAt = Date.now();
          const status = error?.response?.status;

          if (status === 429 && attempt < OPEN_METEO_MAX_ATTEMPTS_ON_429) {
            console.warn(
              `[Simulator] Open-Meteo 429 — retry ${attempt}/${OPEN_METEO_MAX_ATTEMPTS_ON_429 - 1} after ${OPEN_METEO_429_RETRY_DELAY_MS}ms`
            );
            await sleep(OPEN_METEO_429_RETRY_DELAY_MS);
            await this.enforceOpenMeteoMinInterval();
            continue;
          }

          break;
        }
      }

      console.error('[Simulator] weather fetch failed:', lastError?.message || lastError);

      const hadLive =
        this.globalWeather.source === 'open-meteo' ||
        this.globalWeather.source === 'open-meteo-cache';
      this.globalWeather = {
        wind: hadLive ? this.globalWeather.wind : DEFAULT_WEATHER.wind,
        waves: hadLive ? this.globalWeather.waves : DEFAULT_WEATHER.waves,
        updatedAt: new Date().toISOString(),
        source: hadLive ? this.globalWeather.source : 'fallback-default',
        lastSuccessfulSync: this.globalWeather.lastSuccessfulSync,
      };
    } finally {
      this._weatherFetchInFlight = false;
    }
  }

  recordHistorySnapshot() {
    this.historySnapshots.push({
      recordedAt: Date.now(),
      iso: new Date().toISOString(),
      ships: JSON.parse(JSON.stringify(this.getFleetPayload())),
      zones: JSON.parse(JSON.stringify(this.getZonesPayload())),
      threats: JSON.parse(JSON.stringify(this.getThreatPayload())),
      weather: JSON.parse(JSON.stringify(this.getWeatherPayload())),
    });
    while (this.historySnapshots.length > 120) {
      this.historySnapshots.shift();
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    void this.refreshWeather();
    this.weatherIntervalId = setInterval(() => {
      void this.refreshWeather();
    }, WEATHER_REFRESH_MS);
    this.intervalId = setInterval(() => {
      void this.tick();
    }, TICK_MS);
    this.recordHistorySnapshot();
    void this.tick();
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId);
    if (this.weatherIntervalId) clearInterval(this.weatherIntervalId);
    this.intervalId = null;
    this.weatherIntervalId = null;
    this.running = false;
  }

  static isHardCritical(status) {
    return (
      status === 'out_of_fuel' ||
      status === 'stranded' ||
      status === 'geofence_breach'
    );
  }

  isNavigable(lng, lat) {
    const pt = turf.point([lng, lat]);
    return turf.booleanPointInPolygon(pt, this.navigable);
  }

  zoneContaining(lng, lat) {
    const pt = turf.point([lng, lat]);
    for (const zone of this.restrictedZones) {
      if (turf.booleanPointInPolygon(pt, zone.feature)) return zone;
    }
    return null;
  }

  isSegmentBlocked(startLng, startLat, endLng, endLat) {
    const seg = turf.lineString([
      [startLng, startLat],
      [endLng, endLat],
    ]);
    const startPt = turf.point([startLng, startLat]);
    const endPt = turf.point([endLng, endLat]);
    for (const zone of this.restrictedZones) {
      const startInside = turf.booleanPointInPolygon(startPt, zone.feature);
      const endInside = turf.booleanPointInPolygon(endPt, zone.feature);
      if (startInside && !endInside) {
        continue;
      }
      if (turf.booleanIntersects(seg, zone.feature)) return true;
    }
    return false;
  }

  static canMoveStatus(status) {
    return (
      status === 'normal' ||
      status === 'rerouting' ||
      status === 'geofence_breach' ||
      status === 'proximity_warning' ||
      status === 'insufficient_fuel'
    );
  }

  applyFuelAndRangeStatus(ship, tickDurationSec = 1) {
    const moving = ship.speed > 0 && Simulator.canMoveStatus(ship.status);
    const baseBurn = (ship.speed / 10) * tickDurationSec;
    const weatherPenalty =
      this.globalWeather.wind > 25 || this.globalWeather.waves > 2 ? 1.3 : 1.0;
    const fuelConsumptionPerSec = baseBurn * weatherPenalty;
    ship.fuelConsumptionTick = moving ? fuelConsumptionPerSec : 0;

    if (moving) {
      ship.fuel = Math.max(0, ship.fuel - fuelConsumptionPerSec);
    }

    if (ship.fuel <= 0) {
      ship.fuel = 0;
      ship.speed = 0;
      ship.status = 'out_of_fuel';
      return;
    }

    const port = this.portsById[ship.destination];
    if (!port || !moving || fuelConsumptionPerSec <= 0) return;

    const distanceToDestinationKm = turf.distance(
      turf.point([ship.lng, ship.lat]),
      turf.point([port.lng, port.lat]),
      { units: 'kilometers' }
    );

    const kmPerSec = (ship.speed * 1.852) / 3600;
    if (kmPerSec <= 0) return;
    const fuelPerKm = fuelConsumptionPerSec / kmPerSec;
    if (fuelPerKm <= 0) return;

    const reachableKm = ship.fuel / fuelPerKm;
    if (
      reachableKm < distanceToDestinationKm &&
      !Simulator.isHardCritical(ship.status)
    ) {
      ship.status = 'insufficient_fuel';
      const deficit = distanceToDestinationKm - reachableKm;
      const now = Date.now();
      const lastAt = this.lastAdvisorByShip.get(ship.shipId) || 0;
      if (deficit > 5 && now - lastAt > 30000) {
        this.lastAdvisorByShip.set(ship.shipId, now);
        this.io.emit('fleet-advisor-alert', {
          shipId: ship.shipId,
          severity: 'high',
          type: 'fuel_projection',
          summary: `Warning: ${ship.name} will run out of fuel ${Math.round(
            deficit
          )}km before ${ship.destination}. Suggest speed reduction to 12kn.`,
          suggestedAction: 'Reduce speed to 12kn and divert to nearest support port.',
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  tryMoveShip(ship) {
    if (!Simulator.canMoveStatus(ship.status) || ship.speed <= 0) return;

    const startLng = ship.lng;
    const startLat = ship.lat;
    let headingCandidate = ship.heading;
    const originalHeading = ship.heading;
    let moved = false;

    for (let attempt = 0; attempt < 36; attempt += 1) {
      const [nextLng, nextLat] = moveByHeading(
        startLng,
        startLat,
        headingCandidate,
        ship.speed
      );
      const pointBlocked = Boolean(this.zoneContaining(nextLng, nextLat));
      const pathBlocked = this.isSegmentBlocked(
        startLng,
        startLat,
        nextLng,
        nextLat
      );
      const waterBlocked = !this.isNavigable(nextLng, nextLat);

      if (!pointBlocked && !pathBlocked && !waterBlocked) {
        ship.lng = nextLng;
        ship.lat = nextLat;
        ship.heading = normalizeHeading(headingCandidate);
        moved = true;
        break;
      }
      headingCandidate = normalizeHeading(headingCandidate + 10);
    }

    if (!moved) {
      ship.status = 'stranded';
      ship.speed = 0;
    } else if (
      normalizeHeading(originalHeading) !== normalizeHeading(ship.heading) &&
      !Simulator.isHardCritical(ship.status)
    ) {
      ship.status = 'rerouting';
    }
  }

  computeProximityWarnings() {
    /** @type {Set<string>} */
    const warned = new Set();
    for (let i = 0; i < this.ships.length; i += 1) {
      for (let j = i + 1; j < this.ships.length; j += 1) {
        const shipA = this.ships[i];
        const shipB = this.ships[j];
        const dKm = turf.distance(
          turf.point([shipA.lng, shipA.lat]),
          turf.point([shipB.lng, shipB.lat]),
          { units: 'kilometers' }
        );
        if (dKm < PROXIMITY_KM) {
          warned.add(shipA.shipId);
          warned.add(shipB.shipId);
          this.io.emit('proximity', {
            ships: [shipA.shipId, shipB.shipId],
            distanceKm: Number(dKm.toFixed(3)),
          });
          this.io.emit('alert:proximity', {
            ships: [shipA.shipId, shipB.shipId],
            distanceKm: Number(dKm.toFixed(3)),
          });
        }
      }
    }
    return warned;
  }

  async persistShipSubset(list) {
    if (!list.length) return;
    await Promise.all(
      list.map((s) =>
        Ship.updateOne(
          { shipId: s.shipId },
          {
            $set: {
              'location.coordinates': [s.lng, s.lat],
              fuel: s.fuel,
              status: s.status,
              speed: s.baseSpeed,
              heading: s.heading,
              destination: s.destination,
            },
          }
        ).exec()
      )
    );
  }

  async tick() {
    try {
      const statusChanged = [];

      for (const ship of this.ships) {
        const outsideNavigable = !this.isNavigable(ship.lng, ship.lat);
        const zone = this.zoneContaining(ship.lng, ship.lat);
        if (outsideNavigable || zone) {
          if (ship.status !== 'geofence_breach') {
            this.io.emit('geofence', {
              shipId: ship.shipId,
              zoneId: zone?.id ?? null,
              outsideNavigable,
            });
            this.io.emit('alert:geofence', {
              shipId: ship.shipId,
              zoneId: zone?.id ?? null,
              outsideNavigable,
            });
          }
          ship.status = 'geofence_breach';
        } else if (
          ship.status === 'geofence_breach' ||
          ship.status === 'proximity_warning' ||
          ship.status === 'rerouting'
        ) {
          ship.status = 'normal';
        }

        const weather = {
          windSpeed: this.globalWeather.wind,
          waveHeight: this.globalWeather.waves,
        };
        const drag = weather.windSpeed > 25 ? weather.windSpeed * 0.05 : 0;
        const weatherAdjustedSpeed = Math.max(0, ship.baseSpeed - drag);
        ship.envDrag = weather.windSpeed > 25 ? (weather.windSpeed - 25) * 0.1 : 0;
        ship.envDragKnots = ship.envDrag;
        ship.speed = Simulator.canMoveStatus(ship.status)
          ? weatherAdjustedSpeed
          : 0;

        this.tryMoveShip(ship);
        this.applyFuelAndRangeStatus(ship, 1);
      }

      const proximityWarnings = this.computeProximityWarnings();
      for (const ship of this.ships) {
        if (
          proximityWarnings.has(ship.shipId) &&
          !Simulator.isHardCritical(ship.status) &&
          ship.status !== 'insufficient_fuel'
        ) {
          ship.status = 'proximity_warning';
        }
        if (
          !proximityWarnings.has(ship.shipId) &&
          ship.status === 'proximity_warning'
        ) {
          ship.status = 'normal';
        }

        if (ship.status !== ship._prevStatus) {
          ship._prevStatus = ship.status;
          statusChanged.push(ship);
        }
      }

      this.tickDarkVessels();

      const threatEval = evaluateThreatExposure(this.ships, this.darkVessels);
      for (const ev of threatEval) {
        const dv = this.darkVessels.find((d) => d.threatId === ev.threatId);
        if (!dv) continue;
        const prevTier = dv.tier;
        dv.tier = ev.tier;
        dv.minDistanceKm = ev.minDistanceKm;
        dv.closestFriendlyShipId = ev.closestFriendlyShipId;

        if (ev.tier > prevTier) {
          const base = {
            threatId: dv.threatId,
            tier: ev.tier,
            distanceKm: ev.minDistanceKm,
            closestFriendlyShipId: ev.closestFriendlyShipId,
          };
          if (ev.tier === 1) {
            this.io.emit('security-alert', {
              ...base,
              kind: 'detection',
              message: 'Radar contact — unidentified vessel (ghost track)',
            });
          } else if (ev.tier === 2) {
            this.io.emit('security-alert', {
              ...base,
              kind: 'caution',
              message: 'Target of Interest — unidentified vessel closing range',
            });
          } else if (ev.tier === 3) {
            this.io.emit('security-alert', {
              ...base,
              kind: 'threat',
              message: 'Security breach — unidentified vessel inside threat radius',
            });
          }
        }
      }

      this.tickCounter += 1;
      if (this.tickCounter % 30 === 0) {
        this.recordHistorySnapshot();
      }

      this.broadcastFleetUpdate();

      if (statusChanged.length > 0) {
        await this.persistShipSubset(statusChanged);
      }
    } catch (err) {
      console.error('[Simulator] tick failed:', err);
    }
  }
}
