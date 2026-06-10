import { useEffect, useRef } from 'react';
import { FleetAudioEngine } from '../audio/FleetAudioEngine';

const STATUS_SOUND_COOLDOWN_MS = 5000;
const TACTICAL_DEBOUNCE_MS = 650;

function distressAllowedForRole(payload, captainActive, capId) {
  if (!captainActive) return true;
  return payload?.shipId == null || payload.shipId === capId;
}

/**
 * Event-driven fleet audio tied to Socket.io-fed props (alerts, ships, threats, socketStatus).
 * Initializes audio after first user gesture; soft-mute preserves trigger logic.
 */
export function useFleetSoundscape({
  alerts,
  ships,
  threats,
  socketStatus,
  audioMuted,
  userRole,
  captainShipId,
}) {
  const engineRef = useRef(null);
  const unlockedRef = useRef(false);
  const userRoleRef = useRef(userRole);
  const captainShipIdRef = useRef(captainShipId);
  /** Max `alert.at` processed for distress pings — avoids missing distress when a newer non-distress alert is last in the queue */
  const distressSoundCursorRef = useRef(0);
  const distressSoundPrimedRef = useRef(false);
  const prevSocketRef = useRef(undefined);
  const lastStatusSoundAtRef = useRef(0);
  const prevThreatTierRef = useRef(new Map());
  const threatsPrimedRef = useRef(false);
  const lastTacticalAtRef = useRef(0);

  useEffect(() => {
    engineRef.current = new FleetAudioEngine();
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setSoftMuted(audioMuted);
  }, [audioMuted]);

  useEffect(() => {
    userRoleRef.current = userRole;
    captainShipIdRef.current = captainShipId;
  }, [userRole, captainShipId]);

  useEffect(() => {
    const unlock = () => {
      if (unlockedRef.current) return;
      unlockedRef.current = true;
      engineRef.current?.unlock();
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  /** Distress: once per new distress alert (socket timeline), including when newer alerts bury it in the array */
  useEffect(() => {
    const engine = engineRef.current;
    if (!alerts.length || !engine) return;

    if (!distressSoundPrimedRef.current) {
      distressSoundPrimedRef.current = true;
      /* Cold start is []; later populated alerts should still ping. If mount already has backlog, skip history. */
      distressSoundCursorRef.current =
        alerts.length === 0 ? 0 : Math.max(...alerts.map((a) => a.at));
      return;
    }

    const role = userRoleRef.current;
    const capId = captainShipIdRef.current;
    const captainActive = role === 'captain' && !!capId;

    const fresh = alerts.filter(
      (a) =>
        a.type === 'distress' &&
        a.at > distressSoundCursorRef.current &&
        distressAllowedForRole(a.payload, captainActive, capId)
    );
    if (!fresh.length) return;

    distressSoundCursorRef.current = Math.max(distressSoundCursorRef.current, ...fresh.map((a) => a.at));
    engine.unlock();
    for (let i = 0; i < fresh.length; i += 1) {
      engine.playDistressPing();
    }
  }, [alerts]);

  /** Geofence breach — sustained alarm from live ship statuses (no stacking) */
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const breach = ships.some((s) => s.status === 'geofence_breach');
    engine.unlock();
    engine.ensureGeofenceAlarm(breach);
  }, [ships]);

  /** Threat Tier 3 — tactical cue when crossing into THREAT_RADIUS */
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !threats?.length) {
      if (!threats?.length) threatsPrimedRef.current = false;
      return;
    }

    const prevMap = prevThreatTierRef.current;
    if (!threatsPrimedRef.current) {
      threatsPrimedRef.current = true;
      for (const t of threats) {
        prevMap.set(t.threatId, Number(t.tier) || 0);
      }
      return;
    }

    let crossed = false;
    for (const t of threats) {
      const tier = Number(t.tier) || 0;
      const prev = prevMap.get(t.threatId) ?? 0;
      prevMap.set(t.threatId, tier);
      if (tier >= 3 && prev < 3) crossed = true;
    }

    for (const id of [...prevMap.keys()]) {
      if (!threats.some((x) => x.threatId === id)) prevMap.delete(id);
    }

    if (!crossed) return;
    const now = Date.now();
    if (now - lastTacticalAtRef.current < TACTICAL_DEBOUNCE_MS) return;
    lastTacticalAtRef.current = now;
    engine.unlock();
    engine.playTacticalTier3();
  }, [threats]);

  /** Socket link transitions — throttled system thud */
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const prev = prevSocketRef.current;
    prevSocketRef.current = socketStatus;

    if (prev === undefined) return;

    const wasConnected = prev === 'connected';
    const isConnected = socketStatus === 'connected';
    if (wasConnected === isConnected) return;

    const now = Date.now();
    if (now - lastStatusSoundAtRef.current < STATUS_SOUND_COOLDOWN_MS) return;
    lastStatusSoundAtRef.current = now;

    engine.unlock();
    engine.playSystemStatusThud();
  }, [socketStatus]);
}
