import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_URL, TICK_MS } from '../constants/fleet';

export function useInterpolatedFleet() {
  const [socketStatus, setSocketStatus] = useState('connecting');
  const [ships, setShips] = useState([]);
  const [threats, setThreats] = useState([]);
  const [weather, setWeather] = useState({
    wind: 0,
    waves: 0,
    updatedAt: null,
    lastSuccessfulSync: null,
    source: 'unknown',
  });
  const [zones, setZones] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const framesRef = useRef({});
  const rafRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    function renderFrame(now) {
      const next = Object.values(framesRef.current).map((entry) => {
        const t = Math.max(0, Math.min(1, (now - entry.startedAt) / TICK_MS));
        return {
          ...entry.base,
          position: [
            entry.startLat + (entry.targetLat - entry.startLat) * t,
            entry.startLng + (entry.targetLng - entry.startLng) * t,
          ],
        };
      });

      if (mounted) setShips(next.sort((a, b) => a.shipId.localeCompare(b.shipId)));
      rafRef.current = requestAnimationFrame(renderFrame);
    }

    const socket = io(SOCKET_URL, { transports: ['websocket'] });
    socket.on('connect', () => setSocketStatus('connected'));
    socket.on('disconnect', () => setSocketStatus('disconnected'));
    socket.on('fleet-update', (payload) => {
      const fleet = Array.isArray(payload) ? payload : payload?.ships;
      const weatherPayload = Array.isArray(payload) ? null : payload?.weather;
      const zonesPayload = Array.isArray(payload) ? null : payload?.zones;
      const threatsPayload = Array.isArray(payload) ? null : payload?.threats;
      if (!Array.isArray(fleet)) return;
      const now = performance.now();

      for (const incoming of fleet) {
        const prev = framesRef.current[incoming.shipId];
        const progress = prev
          ? Math.max(0, Math.min(1, (now - prev.startedAt) / TICK_MS))
          : 1;

        const startLat = prev
          ? prev.startLat + (prev.targetLat - prev.startLat) * progress
          : incoming.position[0];
        const startLng = prev
          ? prev.startLng + (prev.targetLng - prev.startLng) * progress
          : incoming.position[1];

        framesRef.current[incoming.shipId] = {
          base: incoming,
          startLat,
          startLng,
          targetLat: incoming.position[0],
          targetLng: incoming.position[1],
          startedAt: now,
        };
      }

      if (weatherPayload) {
        setWeather({
          wind: Number(weatherPayload.wind) || 0,
          waves: Number(weatherPayload.waves) || 0,
          updatedAt: weatherPayload.updatedAt ?? null,
          lastSuccessfulSync: weatherPayload.lastSuccessfulSync ?? null,
          source: weatherPayload.source ?? 'unknown',
        });
      }
      if (Array.isArray(zonesPayload)) {
        setZones(zonesPayload);
      }
      if (Array.isArray(threatsPayload)) {
        setThreats(threatsPayload);
      }
    });
    socket.on('zones-updated', (incomingZones) => {
      if (Array.isArray(incomingZones)) setZones(incomingZones);
    });
    socket.on('proximity', (payload) => {
      setAlerts((prev) => [
        ...prev.slice(-20),
        { type: 'proximity', payload, at: Date.now() },
      ]);
    });
    socket.on('alert:proximity', (payload) => {
      setAlerts((prev) => [
        ...prev.slice(-20),
        { type: 'proximity', payload, at: Date.now() },
      ]);
    });
    socket.on('geofence', (payload) => {
      setAlerts((prev) => [
        ...prev.slice(-20),
        { type: 'geofence', payload, at: Date.now() },
      ]);
    });
    socket.on('alert:geofence', (payload) => {
      setAlerts((prev) => [
        ...prev.slice(-20),
        { type: 'geofence', payload, at: Date.now() },
      ]);
    });
    socket.on('new-distress-alert', (payload) => {
      setAlerts((prev) => [
        ...prev.slice(-20),
        { type: 'distress', payload, at: Date.now() },
      ]);
    });
    socket.on('fleet-advisor-alert', (payload) => {
      setAlerts((prev) => [
        ...prev.slice(-20),
        { type: 'fleet_advisor', payload, at: Date.now() },
      ]);
    });
    socket.on('security-alert', (payload) => {
      setAlerts((prev) => [
        ...prev.slice(-20),
        { type: 'security', payload, at: Date.now() },
      ]);
    });

    rafRef.current = requestAnimationFrame(renderFrame);
    return () => {
      mounted = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      socket.disconnect();
    };
  }, []);

  return { ships, threats, socketStatus, weather, zones, alerts };
}
