import { memo, useMemo, useState } from 'react';
import { Marker, Popup } from 'react-leaflet';
import { toast } from 'react-hot-toast';
import { API_URL } from '../../constants/fleet';
import { createDarkThreatIcon } from '../../utils/threatVisuals';

export const DarkThreatMarker = memo(function DarkThreatMarker({
  threat,
  onSelectDarkThreat,
}) {
  const [busy, setBusy] = useState(false);

  const icon = useMemo(
    () => createDarkThreatIcon(threat.tier, Boolean(threat.identified)),
    [threat.tier, threat.identified]
  );

  async function attemptIdentify() {
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/threats/${encodeURIComponent(threat.threatId)}/identify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Identify failed (${res.status})`);
      }
      toast.success(`Identification: ${data.aiLabel || 'Analysis complete'}`);
    } catch (e) {
      toast.error(e.message || 'Identification failed');
    } finally {
      setBusy(false);
    }
  }

  const dist =
    threat.distanceKm != null && Number.isFinite(Number(threat.distanceKm))
      ? Number(threat.distanceKm).toFixed(2)
      : '—';

  return (
    <Marker
      position={threat.position}
      icon={icon}
      eventHandlers={{
        click: () => onSelectDarkThreat(threat.threatId),
      }}
    >
      <Popup>
        <div className="dark-threat-popup">
          <strong>{threat.identified ? threat.aiLabel || 'Identified threat' : 'Unidentified contact'}</strong>
          <div className="dark-threat-popup-meta">
            ID: {threat.threatId}
            <br />
            Range (closest friendly): {dist} km
            <br />
            Tier: {threat.tier} · Speed: {Number(threat.speed ?? 0).toFixed(1)} kn · Behavior:{' '}
            {threat.behavior || 'unknown'}
          </div>
          {!threat.identified ? (
            <button
              type="button"
              className="tool-btn dark-threat-id-btn"
              disabled={busy || threat.tier < 1}
              onClick={attemptIdentify}
            >
              {busy ? 'Analyzing…' : 'Attempt identification (Gemini)'}
            </button>
          ) : (
            <div className="dark-threat-classified">Signature classified — icon locked as identified threat.</div>
          )}
        </div>
      </Popup>
    </Marker>
  );
});
