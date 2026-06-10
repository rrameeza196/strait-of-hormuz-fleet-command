import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Circle,
  GeoJSON,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
} from 'react-leaflet';
import { Compass, FilterX, LocateFixed, Menu, Orbit, X } from 'lucide-react';
import { Toaster, toast } from 'react-hot-toast';
import { API_URL, MAP_CENTER, MAP_ZOOM, PORTS } from './constants/fleet';
import { useInterpolatedFleet } from './hooks/useInterpolatedFleet';
import { useFleetSoundscape } from './hooks/useFleetSoundscape';
import { useTelemetryPulse } from './hooks/useTelemetryPulse';
import { utcClockString } from './utils/time';
import { inferShipType, isCriticalStatus } from './utils/shipVisuals';
import { ShipMarker } from './components/map/ShipMarker';
import { DarkThreatMarker } from './components/map/DarkThreatMarker';
import { CommandSearch } from './components/CommandSearch';
import { MapFocusController } from './components/map/MapFocusController';
import { CursorHudController } from './components/map/CursorHudController';
import { MapActionsController } from './components/map/MapActionsController';
import { MapViewportController } from './components/map/MapViewportController';
import { DrawZonesController } from './components/map/DrawZonesController';
import {
  BottomCenterHud,
  BottomLeftHud,
  PlaybackHud,
  TopCenterHud,
  TopRightUtcHud,
  TopLeftHud,
} from './components/hud/HudPanels';
import { CommandSidebar } from './components/sidebar/CommandSidebar';

function kmBetween(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const [lat1, lng1] = a;
  const [lat2, lng2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 =
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(s1 + s2), Math.sqrt(1 - (s1 + s2)));
}

function stripCommandNameTail(s) {
  return String(s || '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/[.?!"')]+$/g, '')
    .trim();
}

function findShipByLooseName(rawName, shipList) {
  const n = stripCommandNameTail(rawName).toLowerCase();
  if (!n) return null;
  const exact = shipList.find((ship) => ship.name.toLowerCase() === n);
  if (exact) return exact;
  return shipList.find((ship) => ship.name.toLowerCase().includes(n)) || null;
}

const OPERATIONAL_LOG_CAP = 40;
const FLEET_ADVISOR_LOG_DEDUPE_MS = 120000;

/** Rolling operational log (fleet advisor, distress, security) — survives banner churn. */
function mergeOperationalLog(prev, entry) {
  let next = [...prev, entry];
  if (entry.channel === 'fleet_advisor' && prev.length > 0) {
    const last = prev[prev.length - 1];
    if (
      last.channel === 'fleet_advisor' &&
      last.shipId === entry.shipId &&
      entry.receivedAt - last.receivedAt < FLEET_ADVISOR_LOG_DEDUPE_MS
    ) {
      next = [...prev.slice(0, -1), { ...entry, id: last.id }];
    }
  }
  return next.slice(-OPERATIONAL_LOG_CAP);
}

export default function App() {
  const {
    ships: liveShips,
    threats: liveThreats,
    socketStatus,
    weather: liveWeather,
    zones: liveZones,
    alerts,
  } = useInterpolatedFleet();

  const [historySnapshots, setHistorySnapshots] = useState([]);
  const [replayIdx, setReplayIdx] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function pullHistory() {
      try {
        const r = await fetch(`${API_URL}/api/history`);
        const data = await r.json();
        if (!cancelled && Array.isArray(data)) setHistorySnapshots(data);
      } catch {
        /* offline — retain cached snapshots list */
      }
    }
    pullHistory();
    const id = setInterval(pullHistory, 45_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const replaySnap =
    replayIdx !== null && historySnapshots.length > 0 ? historySnapshots[replayIdx] : null;
  const ships = replaySnap?.ships ?? liveShips;
  const zones = replaySnap?.zones ?? liveZones;
  const threats = replaySnap?.threats ?? liveThreats;
  const weather = replaySnap?.weather ?? liveWeather;

  const telemetryPulse = useTelemetryPulse(liveShips);

  const [audioMuted, setAudioMuted] = useState(
    () => typeof sessionStorage !== 'undefined' && sessionStorage.getItem('fleetAudioMuted') === '1'
  );

  const [userRole, setUserRole] = useState('command');
  const [captainShipId, setCaptainShipId] = useState('');
  const [distressMessage, setDistressMessage] = useState('');
  const [selectedShipId, setSelectedShipId] = useState('');
  const [selectedDarkThreatId, setSelectedDarkThreatId] = useState('');
  const [hoveredShipId, setHoveredShipId] = useState('');
  const [navigableWater, setNavigableWater] = useState(null);
  const [cursorCoords, setCursorCoords] = useState(MAP_CENTER);
  const [utcClock, setUtcClock] = useState(utcClockString());
  const [followSelected, setFollowSelected] = useState(false);
  const [focusNonce, setFocusNonce] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [distressPulseByShip, setDistressPulseByShip] = useState({});
  const [typeFilter, setTypeFilter] = useState('all');
  const [mapTheme, setMapTheme] = useState('dark');
  const [commandFilterShipIds, setCommandFilterShipIds] = useState(null);
  const [commandProximity, setCommandProximity] = useState(null);
  const [latestRecommendation, setLatestRecommendation] = useState(null);
  const [operationalLog, setOperationalLog] = useState([]);
  const [radarContactMemory, setRadarContactMemory] = useState({});
  const [diversionRoutes, setDiversionRoutes] = useState({});

  const markerRefs = useRef({});
  const mapRef = useRef(null);
  const lastAlertAtRef = useRef(0);
  const userRoleRef = useRef(userRole);
  const captainShipIdRef = useRef(captainShipId);

  useEffect(() => {
    userRoleRef.current = userRole;
    captainShipIdRef.current = captainShipId;
  }, [userRole, captainShipId]);

  useFleetSoundscape({
    alerts,
    ships: liveShips,
    threats: liveThreats,
    socketStatus,
    audioMuted,
    userRole,
    captainShipId,
  });

  useEffect(() => {
    try {
      sessionStorage.setItem('fleetAudioMuted', audioMuted ? '1' : '0');
    } catch {
      /* private mode */
    }
  }, [audioMuted]);

  useEffect(() => {
    const timer = setInterval(() => setUtcClock(utcClockString()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1100px)');
    const sync = () => {
      setIsMobile(media.matches);
      setSidebarOpen(!media.matches);
    };
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch(`${API_URL}/api/navigable-water`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setNavigableWater(data);
      })
      .catch((err) => {
        console.error('Failed to load navigable water:', err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (replayIdx === null) return;
    if (!historySnapshots.length) {
      setReplayIdx(null);
      return;
    }
    if (replayIdx > historySnapshots.length - 1) {
      setReplayIdx(historySnapshots.length - 1);
    }
  }, [historySnapshots, replayIdx]);

  const selectedShip = useMemo(
    () => ships.find((s) => s.shipId === selectedShipId) || null,
    [selectedShipId, ships]
  );
  const visibleShips = useMemo(() => {
    if (userRole === 'captain') {
      if (!captainShipId) return [];
      return ships.filter((s) => s.shipId === captainShipId);
    }
    if (typeFilter === 'all') return ships;
    return ships.filter((s) => inferShipType(s) === typeFilter);
  }, [captainShipId, ships, userRole, typeFilter]);

  const sidebarRecommendation = useMemo(() => {
    if (!latestRecommendation) return null;
    if (userRole === 'captain' && captainShipId) {
      return latestRecommendation.shipId === captainShipId ? latestRecommendation : null;
    }
    return latestRecommendation;
  }, [captainShipId, latestRecommendation, userRole]);

  useEffect(() => {
    const now = Date.now();
    const ttlMs = 45 * 60 * 1000;
    setRadarContactMemory((prev) => {
      const next = { ...prev };
      for (const t of threats) {
        const id = t.threatId;
        const tier = Number(t.tier) || 0;
        const existing = next[id];
        if (tier >= 1) {
          next[id] = {
            threatId: id,
            tier,
            distanceKm: t.distanceKm,
            closestFriendlyShipId: t.closestFriendlyShipId,
            identified: Boolean(t.identified),
            aiLabel: t.aiLabel || null,
            lastPingAt: now,
            droppedAt: null,
            maxTier: Math.max(tier, existing?.maxTier ?? 0),
          };
        } else if (existing) {
          const justDropped = existing.tier >= 1 && tier < 1;
          next[id] = {
            ...existing,
            tier,
            distanceKm: t.distanceKm,
            closestFriendlyShipId: t.closestFriendlyShipId,
            identified: Boolean(t.identified),
            aiLabel: t.aiLabel || existing.aiLabel,
            lastPingAt: now,
            droppedAt: justDropped ? now : existing.droppedAt,
            maxTier: Math.max(existing.maxTier ?? 0, tier),
          };
        }
      }
      for (const id of Object.keys(next)) {
        const e = next[id];
        if (e.tier >= 1) continue;
        if ((e.maxTier ?? 0) < 1) {
          delete next[id];
          continue;
        }
        if (e.droppedAt && now - e.droppedAt > ttlMs) delete next[id];
      }
      return next;
    });
  }, [threats]);

  const commandFilterSet = useMemo(
    () => (commandFilterShipIds ? new Set(commandFilterShipIds) : null),
    [commandFilterShipIds]
  );

  const commandMapFocusActive = Boolean(commandProximity || commandFilterShipIds);

  function clearCommandMapFocus() {
    setCommandProximity(null);
    setCommandFilterShipIds(null);
  }

  const commandProximityLinePositions = useMemo(() => {
    if (!commandProximity) return null;
    const a = ships.find((s) => s.shipId === commandProximity.anchorShipId);
    const n = ships.find((s) => s.shipId === commandProximity.nearestShipId);
    if (!a || !n) return null;
    return [a.position, n.position];
  }, [commandProximity, ships]);

  const commandProximityLive = useMemo(() => {
    if (!commandProximity) return null;
    const a = ships.find((s) => s.shipId === commandProximity.anchorShipId);
    const n = ships.find((s) => s.shipId === commandProximity.nearestShipId);
    if (!a || !n) return null;
    const km = kmBetween(a.position, n.position);
    return {
      km,
      nm: km / 1.852,
      anchorName: a.name,
      nearestName: n.name,
    };
  }, [commandProximity, ships]);

  useEffect(() => {
    if (userRole === 'captain' && captainShipId) {
      handleSelectShip(captainShipId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captainShipId, userRole]);

  const maxBounds = useMemo(() => {
    const box = navigableWater?.properties?.boundingBox;
    if (!box) return undefined;
    return [
      [box.south, box.west],
      [box.north, box.east],
    ];
  }, [navigableWater]);

  const tileConfig = useMemo(() => {
    if (mapTheme === 'dark') {
      return {
        url: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
        labelUrl:
          'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png',
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; CartoDB',
      };
    }
    return {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      labelUrl: null,
      attribution:
        'Tiles &copy; Esri',
    };
  }, [mapTheme]);

  const navigableStyle = useMemo(() => {
    if (mapTheme === 'dark') {
      return {
        color: '#67e8f9',
        weight: 1.8,
        fillColor: '#38bdf8',
        fillOpacity: 0.17,
        dashArray: '4 6',
      };
    }
    return {
      color: '#0284c7',
      weight: 1.6,
      fillColor: '#0ea5e9',
      fillOpacity: 0.1,
      dashArray: '2 6',
    };
  }, [mapTheme]);

  function goHomeView() {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo(MAP_CENTER, MAP_ZOOM, { animate: true, duration: 1.1 });
  }

  function fitFleetView() {
    const map = mapRef.current;
    if (!map || ships.length === 0) return;
    map.fitBounds(ships.map((ship) => ship.position), {
      animate: true,
      duration: 1.1,
      padding: [35, 35],
    });
  }

  function fitZoneView() {
    const map = mapRef.current;
    if (!map || !navigableWater?.geometry?.coordinates?.[0]) return;
    const latLngs = navigableWater.geometry.coordinates[0].map(([lng, lat]) => [
      lat,
      lng,
    ]);
    map.fitBounds(latLngs, {
      animate: true,
      duration: 1.1,
      padding: [30, 30],
    });
  }

  function handleSelectShip(shipId) {
    setSelectedShipId(shipId);
    setSelectedDarkThreatId('');
    setHoveredShipId(shipId);
    setFocusNonce((n) => n + 1);
    if (isMobile) setSidebarOpen(false);
  }

  function handleSelectDarkThreat(threatId) {
    setSelectedDarkThreatId(threatId);
    setSelectedShipId('');
    setHoveredShipId('');
  }

  function handleFocusThreatOnMap(threatId) {
    const t = threats.find((x) => x.threatId === threatId);
    const map = mapRef.current;
    if (!t?.position || !map) return;
    map.flyTo(t.position, Math.max(map.getZoom(), 9), {
      animate: true,
      duration: 1.1,
    });
    handleSelectDarkThreat(threatId);
    if (isMobile) setSidebarOpen(false);
  }

  async function handleCreateZone(feature) {
    try {
      await fetch(`${API_URL}/api/zones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(feature),
      });
      toast.success('Restricted zone added');
    } catch (error) {
      toast.error('Failed to add zone');
    }
  }

  async function handleDeleteZone(zoneId) {
    try {
      const res = await fetch(`${API_URL}/api/zones/${encodeURIComponent(zoneId)}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || 'Delete failed');
      }
      toast.success('Zone removed');
    } catch (error) {
      toast.error(error.message || 'Failed to delete zone');
    }
  }

  async function handleCaptainAcceptCourse() {
    if (!captainShipId) return;
    try {
      const res = await fetch(`${API_URL}/api/ships/${captainShipId}/accept-course`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || 'Accept course failed');
      }
      toast.success('Course accepted — heading synced on next telemetry tick');
    } catch (error) {
      toast.error(error.message || 'Accept course failed');
    }
  }

  async function handleSendDistress() {
    if (!captainShipId || !distressMessage.trim()) return;
    try {
      const response = await fetch(`${API_URL}/api/distress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipId: captainShipId, message: distressMessage }),
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || 'Distress analysis failed');
      }
      toast.success('Distress transmitted to command');
    } catch (error) {
      toast.error(error.message || 'Distress analysis failed');
    }
  }

  async function applyRecommendation(payload) {
    const ship = ships.find((s) => s.shipId === payload?.shipId);
    if (!ship) {
      toast.error('Ship not found for recommendation.');
      return;
    }
    const actionText = String(payload?.suggestedAction || '');
    const normalize = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim();
    const normAction = normalize(actionText);
    const tokenSet = new Set(normAction.split(/\s+/).filter(Boolean));
    const scored = PORTS.map((p) => {
      const normName = normalize(p.name);
      const nameTokens = normName.split(/\s+/).filter(Boolean);
      let score = 0;
      if (normAction.includes(normName)) score += 3;
      for (const token of nameTokens) {
        if (tokenSet.has(token)) score += 1;
      }
      return { port: p, score };
    }).sort((a, b) => b.score - a.score);

    const withSignal = scored[0]?.score > 0 ? scored[0].port : null;
    const nearestPort = PORTS.slice().sort(
      (a, b) => kmBetween(ship.position, a.position) - kmBetween(ship.position, b.position)
    )[0];
    const matchedPort = withSignal || nearestPort;

    try {
      const response = await fetch(`${API_URL}/api/ships/${payload.shipId}/destination`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination: matchedPort.id }),
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to apply recommendation');
      }
      setDiversionRoutes((prev) => ({
        ...prev,
        [payload.shipId]: { destinationId: matchedPort.id, updatedAt: Date.now() },
      }));
      toast.success(
        `Route updated: ${ship.name} is now diverting to nearest support station (${matchedPort.name}).`
      );
    } catch (error) {
      toast.error(error.message || 'Failed to apply recommendation');
    }
  }

  function zoomToShipCluster(ids) {
    const map = mapRef.current;
    if (!map || !ids?.length) return;
    const selected = ships.filter((s) => ids.includes(s.shipId));
    if (!selected.length) return;
    map.fitBounds(selected.map((s) => s.position), {
      animate: true,
      duration: 0.9,
      padding: [40, 40],
    });
  }

  function handleRunCommand(query) {
    const q = query.trim().toLowerCase();
    const clearsCommandFocus =
      /^(clear|reset)(\s+(map\s*)?(filter|focus|highlight|command))?$/.test(q) ||
      /^show\s+all\s+(ships?|fleet)$/.test(q) ||
      /^show\s+full\s+fleet$/.test(q) ||
      /^exit\s+(focus|filter)$/.test(q);

    if (clearsCommandFocus) {
      clearCommandMapFocus();
      toast.success('Full fleet visible — command highlights cleared.');
      return;
    }

    setCommandProximity(null);
    let ids = ships.map((s) => s.shipId);

    const closestPatterns = [
      /find\s+(?:the\s+)?closest\s+ship\s+to\s+(.+)/i,
      /closest\s+ship\s+to\s+(.+)/i,
      /nearest\s+ship\s+to\s+(.+)/i,
      /\bclosest\s+to\s+(.+)/i,
      /\bnearest\s+to\s+(.+)/i,
    ];

    for (const re of closestPatterns) {
      const m = query.match(re);
      if (!m?.[1]) continue;
      const anchor = findShipByLooseName(m[1], ships);
      if (!anchor) {
        toast.error(`No ship matches "${stripCommandNameTail(m[1])}".`);
        return;
      }
      const others = ships.filter((s) => s.shipId !== anchor.shipId);
      if (!others.length) {
        toast.error('There are no other vessels to compare.');
        return;
      }
      let nearest = others[0];
      let bestKm = kmBetween(nearest.position, anchor.position);
      for (let i = 1; i < others.length; i += 1) {
        const s = others[i];
        const d = kmBetween(s.position, anchor.position);
        if (d < bestKm) {
          bestKm = d;
          nearest = s;
        }
      }
      const nm = bestKm / 1.852;
      setCommandProximity({
        anchorShipId: anchor.shipId,
        nearestShipId: nearest.shipId,
      });
      ids = [anchor.shipId, nearest.shipId];
      setCommandFilterShipIds(ids);
      setSelectedShipId(nearest.shipId);
      setHoveredShipId(nearest.shipId);
      setFocusNonce((n) => n + 1);
      zoomToShipCluster(ids);
      toast.success(
        `Nearest to ${anchor.name}: ${nearest.name} (~${nm.toFixed(1)} nm, ${bestKm.toFixed(1)} km). Amber ring = reference ship · Green ring = closest. Distance stays in the toolbar and on the line until you clear focus.`,
        { duration: 6500 }
      );
      return;
    }

    if (/distress|emergency/.test(q)) {
      ids = ships
        .filter(
          (s) =>
            s?.distress?.active ||
            s.status === 'geofence_breach' ||
            s.status === 'out_of_fuel' ||
            s.status === 'stranded'
        )
        .map((s) => s.shipId);
    } else if (/low fuel|insufficient fuel|fuel/.test(q)) {
      ids = ships
        .filter((s) => s.status === 'insufficient_fuel' || s.fuel < 1500)
        .map((s) => s.shipId);
    } else if (/tanker/.test(q)) {
      ids = ships.filter((s) => inferShipType(s) === 'tanker').map((s) => s.shipId);
    } else if (/passenger|ferry/.test(q)) {
      ids = ships.filter((s) => inferShipType(s) === 'passenger').map((s) => s.shipId);
    } else {
      const nearMatch = q.match(/near\s+([a-z0-9\- ]+)/i);
      if (nearMatch?.[1]) {
        const name = nearMatch[1].trim();
        const anchor = ships.find((s) => s.name.toLowerCase().includes(name));
        if (anchor) {
          ids = ships
            .filter((s) => kmBetween(s.position, anchor.position) <= 60)
            .map((s) => s.shipId);
        } else {
          ids = [];
        }
      }
    }

    if (!ids.length) {
      toast.error('No ships matched the command.');
      return;
    }
    setCommandFilterShipIds(ids);
    zoomToShipCluster(ids);
  }

  useEffect(() => {
    if (!alerts.length) return;
    const latest = alerts[alerts.length - 1];
    if (!latest || latest.at <= lastAlertAtRef.current) return;
    lastAlertAtRef.current = latest.at;

    const role = userRoleRef.current;
    const capId = captainShipIdRef.current;
    const captainActive = role === 'captain' && !!capId;
    const payload = latest.payload || {};

    if (captainActive) {
      let allow = true;
      switch (latest.type) {
        case 'proximity':
          allow = (payload.ships || []).includes(capId);
          break;
        case 'geofence':
          allow = payload.shipId === capId;
          break;
        case 'distress':
          allow = payload.shipId == null || payload.shipId === capId;
          break;
        case 'fleet_advisor':
          allow = payload.shipId === capId;
          break;
        case 'security':
          allow = false;
          break;
        default:
          allow = true;
      }
      if (!allow) return;
    }

    if (latest.type === 'proximity') {
      toast.error(
        `Proximity alert: ${latest.payload.ships?.[0]} & ${latest.payload.ships?.[1]}`
      );
    } else if (latest.type === 'geofence') {
      toast.error(`Geofence breach: ${latest.payload.shipId}`);
    } else if (latest.type === 'distress') {
      const severity = latest.payload?.severity || 'medium';
      const border = severity === 'high' ? '#ff2d55' : '#f59e0b';
      setLatestRecommendation(latest.payload);
      const receivedAt = Date.now();
      setOperationalLog((prev) =>
        mergeOperationalLog(prev, {
          id: `distress-${receivedAt}-${Math.random().toString(36).slice(2, 9)}`,
          channel: 'distress',
          receivedAt,
          severity,
          injuries:
            typeof latest.payload?.injuries === 'number' ? latest.payload.injuries : undefined,
          problemType: latest.payload?.type || 'general',
          summaryLine:
            latest.payload?.summary ||
            `Distress (${severity}) — ${latest.payload?.shipId || 'unknown ship'}`,
          shipId: latest.payload?.shipId,
        })
      );
      toast.custom((t) => (
        <div
          className="ai-recommend-toast"
          style={{ border: `2px solid ${border}`, opacity: t.visible ? 1 : 0.2 }}
        >
          <div>
            <strong>
              Severity: {severity.toUpperCase()} | Type:{' '}
              {String(latest.payload?.type || 'general')}
            </strong>
          </div>
          <div>{latest.payload?.summary || 'Distress alert received'}</div>
          <div className="ai-recommend-box">
            AI Recommendation: {latest.payload?.suggestedAction || 'Monitor and coordinate support.'}
          </div>
          <button
            type="button"
            className="tool-btn"
            onClick={() => {
              applyRecommendation(latest.payload);
              toast.dismiss(t.id);
            }}
          >
            Apply AI Recommendation
          </button>
        </div>
      ));
      if (latest.payload?.shipId) {
        setDistressPulseByShip((prev) => ({
          ...prev,
          [latest.payload.shipId]: Date.now(),
        }));
      }
    } else if (latest.type === 'fleet_advisor') {
      toast.error(latest.payload?.summary || 'Fleet advisor warning');
      setLatestRecommendation(latest.payload);
      const receivedAt = Date.now();
      setOperationalLog((prev) =>
        mergeOperationalLog(prev, {
          id: `fleet-${receivedAt}-${Math.random().toString(36).slice(2, 9)}`,
          channel: 'fleet_advisor',
          receivedAt,
          summaryLine:
            latest.payload?.summary ||
            `Fleet advisor — ${latest.payload?.shipId || 'fleet'}`,
          shipId: latest.payload?.shipId,
        })
      );
    } else if (latest.type === 'security') {
      const p = latest.payload || {};
      const msg = p.message || 'Security alert';
      const receivedAt = Date.now();
      setOperationalLog((prev) =>
        mergeOperationalLog(prev, {
          id: `security-${receivedAt}-${Math.random().toString(36).slice(2, 9)}`,
          channel: 'security',
          receivedAt,
          summaryLine: msg,
          securityKind: p.kind || 'info',
        })
      );
      if (p.kind === 'threat') {
        toast.error(msg, { duration: 8000 });
      } else if (p.kind === 'caution') {
        toast(msg, {
          duration: 6000,
          style: { borderLeft: '4px solid #eab308' },
        });
      } else {
        toast(msg, {
          duration: 4500,
          style: { borderLeft: '4px solid #38bdf8' },
        });
      }
    }
  }, [alerts]);

  return (
    <div className={`layout ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <Toaster
        position="top-center"
        containerClassName="nv-toast-rail"
        containerStyle={{ top: 96, zIndex: 1500 }}
        toastOptions={{
          duration: 4500,
          className: 'nv-toast',
        }}
        gutter={10}
      />
      <div className={`map-wrap map-theme-${mapTheme}`}>
        <CommandSearch onRunCommand={handleRunCommand} />
        <div className="map-cinematic-overlay" aria-hidden="true" />
        <div className="map-grid-overlay" aria-hidden="true" />
        <div className="map-horizon" aria-hidden="true" />
        <div className="map-vignette" aria-hidden="true" />
        <div className="map-classification-strip" aria-hidden="true">
          <span>// CLASSIFIED // NAVAL TACTICAL OPERATIONS // {mapTheme.toUpperCase()} OVERLAY //</span>
        </div>
        <TopLeftHud
          socketStatus={socketStatus}
          shipsCount={ships.length}
          audioMuted={audioMuted}
          onToggleAudioMute={() => setAudioMuted((v) => !v)}
        />
        <TopRightUtcHud utcClock={utcClock} />
        <TopCenterHud windSpeed={weather.wind} />
        <BottomLeftHud cursorCoords={cursorCoords} />
        <PlaybackHud
          snapshots={historySnapshots}
          replayIdx={replayIdx}
          onReplayIdxChange={(idx) => setReplayIdx(idx)}
          onLive={() => setReplayIdx(null)}
        />
        <BottomCenterHud weather={weather} />
        <div className="hud-panel hud-top-right rounded-xl map-tools">
          {isMobile ? (
            <button
              type="button"
              className="tool-btn mobile-only"
              onClick={() => setSidebarOpen((v) => !v)}
            >
              {sidebarOpen ? <X size={14} /> : <Menu size={14} />}
              <span className="tool-label">
                {sidebarOpen ? 'Close Panel' : 'Open Panel'}
              </span>
            </button>
          ) : null}
          {commandMapFocusActive ? (
            <button
              type="button"
              className="tool-btn command-clear-focus-btn"
              onClick={() => {
                clearCommandMapFocus();
                toast.success('Full fleet visible — highlights cleared.');
              }}
              title="Clear command filter, pairing line, and marker rings"
            >
              <FilterX size={14} />
              <span className="tool-label">Clear focus</span>
            </button>
          ) : null}
          {commandProximityLive ? (
            <div
              className="command-proximity-hud-chip"
              role="status"
              aria-live="polite"
              title="Live separation along the green dashed line"
            >
              <span className="command-proximity-hud-names">
                {commandProximityLive.anchorName} ↔ {commandProximityLive.nearestName}
              </span>
              <span className="command-proximity-hud-dist">
                {commandProximityLive.nm.toFixed(1)} nm · {commandProximityLive.km.toFixed(1)} km
              </span>
            </div>
          ) : null}
          <button
            type="button"
            className="tool-btn"
            onClick={goHomeView}
            disabled={!mapRef.current}
          >
            <Compass size={14} />
            <span className="tool-label">Home</span>
          </button>
          <button
            type="button"
            className="tool-btn"
            onClick={fitFleetView}
            disabled={!mapRef.current || liveShips.length === 0}
          >
            <LocateFixed size={14} />
            <span className="tool-label">Fit Fleet</span>
          </button>
          <button
            type="button"
            className="tool-btn"
            onClick={fitZoneView}
            disabled={!mapRef.current || !navigableWater}
          >
            <Orbit size={14} />
            <span className="tool-label">Fit Zone</span>
          </button>
          <button
            type="button"
            className={`tool-btn ${followSelected ? 'active' : ''}`}
            onClick={() => setFollowSelected((v) => !v)}
          >
            <span className="tool-label">Follow Selected</span>
          </button>
          <button
            type="button"
            className="tool-btn"
            onClick={() => setMapTheme((prev) => (prev === 'dark' ? 'earth' : 'dark'))}
          >
            <span className="tool-label">
              Theme: {mapTheme === 'dark' ? 'Tactical Dark' : 'Earth Contrast'}
            </span>
          </button>
          <div className="role-toggle">
            <button
              type="button"
              className={`tool-btn ${userRole === 'command' ? 'active' : ''}`}
              onClick={() => setUserRole('command')}
            >
              <span className="tool-label">COMMAND</span>
            </button>
            <button
              type="button"
              className={`tool-btn ${userRole === 'captain' ? 'active' : ''}`}
              onClick={() => setUserRole('captain')}
            >
              <span className="tool-label">CAPTAIN</span>
            </button>
          </div>
        </div>

        <MapContainer
          className="fleet-map"
          center={MAP_CENTER}
          zoom={MAP_ZOOM}
          minZoom={6}
          maxZoom={11}
          maxBounds={maxBounds}
          maxBoundsViscosity={0.45}
          scrollWheelZoom
          wheelDebounceTime={16}
          wheelPxPerZoomLevel={42}
        >
          <TileLayer
            attribution={tileConfig.attribution}
            url={tileConfig.url}
          />
          {tileConfig.labelUrl ? (
            <TileLayer
              attribution={tileConfig.attribution}
              url={tileConfig.labelUrl}
              className="country-label-layer"
              zIndex={450}
            />
          ) : null}

          {navigableWater ? (
            <GeoJSON
              data={navigableWater}
              style={navigableStyle}
            />
          ) : null}

          {userRole === 'command'
            ? visibleShips.map((ship) => (
                <Circle
                  key={`radar-${ship.shipId}`}
                  center={ship.position}
                  radius={10000}
                  interactive={false}
                  pathOptions={{
                    className: 'leaflet-radar-ring',
                    stroke: true,
                    color: 'rgba(103, 232, 249, 0.58)',
                    weight: 1.35,
                    opacity: 0.92,
                    fill: false,
                    fillOpacity: 0,
                    fillColor: 'transparent',
                    dashArray: '22 16',
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                />
              ))
            : null}

          {visibleShips.map((ship) => (
            <ShipMarker
              key={ship.shipId}
              ship={ship}
              markerRefs={markerRefs}
              highlighted={
                hoveredShipId === ship.shipId ||
                commandProximity?.nearestShipId === ship.shipId
              }
              distressPulse={
                ship?.distress?.active ||
                isCriticalStatus(ship.status) ||
                (Date.now() - (distressPulseByShip[ship.shipId] || 0) < 6000)
              }
              dimmed={
                Boolean(commandFilterSet) && !commandFilterSet.has(ship.shipId)
              }
              commandAnchor={commandProximity?.anchorShipId === ship.shipId}
              commandTarget={commandProximity?.nearestShipId === ship.shipId}
              onSelectShip={handleSelectShip}
            />
          ))}

          {userRole === 'command'
            ? threats
                .filter((t) => t.tier >= 1)
                .map((t) => (
                  <DarkThreatMarker
                    key={t.threatId}
                    threat={t}
                    onSelectDarkThreat={handleSelectDarkThreat}
                  />
                ))
            : null}

          {Object.entries(diversionRoutes).map(([shipId, route]) => {
            const ship = ships.find((s) => s.shipId === shipId);
            const port = PORTS.find((p) => p.id === route.destinationId);
            if (!ship || !port) return null;
            return (
              <Polyline
                key={`divert-${shipId}`}
                positions={[ship.position, port.position]}
                pathOptions={{
                  color: '#f59e0b',
                  weight: 2,
                  dashArray: '6 8',
                  opacity: 0.9,
                }}
              />
            );
          })}

          {commandProximityLinePositions ? (
            <Polyline
              key="command-closest-link"
              positions={commandProximityLinePositions}
              pathOptions={{
                color: '#34d399',
                weight: 3,
                dashArray: '12 10',
                opacity: 0.92,
                lineCap: 'round',
              }}
            >
              {commandProximityLive ? (
                <Tooltip
                  permanent
                  direction="center"
                  opacity={1}
                  className="command-proximity-distance-tip"
                >
                  <div className="command-proximity-distance-inner">
                    <div className="command-proximity-distance-names">
                      {commandProximityLive.anchorName} ↔ {commandProximityLive.nearestName}
                    </div>
                    <div className="command-proximity-distance-values">
                      {commandProximityLive.nm.toFixed(1)} nm · {commandProximityLive.km.toFixed(1)} km
                    </div>
                  </div>
                </Tooltip>
              ) : null}
            </Polyline>
          ) : null}

          <DrawZonesController
            userRole={userRole}
            zones={zones}
            onCreateZone={handleCreateZone}
          />
          <MapFocusController
            selectedShip={selectedShip}
            markerRefs={markerRefs}
            followSelected={followSelected}
            focusNonce={focusNonce}
            openPopupOnSelect={userRole !== 'command'}
          />
          <MapActionsController
            onReady={(map) => {
              mapRef.current = map;
            }}
          />
          <MapViewportController
            sidebarOpen={sidebarOpen}
            isMobile={isMobile}
            maxBounds={maxBounds}
            maxBoundsViscosity={0.45}
          />
          <CursorHudController onMove={setCursorCoords} />
        </MapContainer>
      </div>

      {isMobile && sidebarOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close panel"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <CommandSidebar
        ships={visibleShips}
        threats={threats}
        radarContactMemory={radarContactMemory}
        operationalLog={operationalLog}
        onClearOperationalLog={() => setOperationalLog([])}
        onDismissRecommendation={() => setLatestRecommendation(null)}
        allShips={liveShips}
        selectedDarkThreatId={selectedDarkThreatId}
        onFocusThreat={handleFocusThreatOnMap}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        latestRecommendation={sidebarRecommendation}
        onApplyRecommendation={applyRecommendation}
        selectedShipId={selectedShipId}
        onSelectShip={handleSelectShip}
        setHoveredShipId={setHoveredShipId}
        telemetryPulse={telemetryPulse}
        socketStatus={socketStatus}
        userRole={userRole}
        captainShipId={captainShipId}
        onCaptainShipChange={setCaptainShipId}
        distressMessage={distressMessage}
        onDistressChange={setDistressMessage}
        onSendDistress={handleSendDistress}
        zones={zones}
        onDeleteZone={userRole === 'command' ? handleDeleteZone : undefined}
        onCaptainAcceptCourse={handleCaptainAcceptCourse}
        replayActive={replayIdx !== null}
        isMobile={isMobile}
        onCloseMobile={() => setSidebarOpen(false)}
      />
    </div>
  );
}
