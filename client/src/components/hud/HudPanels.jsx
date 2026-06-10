import { Wind, Activity, Globe2, Crosshair, Volume2, VolumeX, History } from 'lucide-react';

export function TopLeftHud({ socketStatus, shipsCount, audioMuted, onToggleAudioMute }) {
  return (
    <div className="hud-panel hud-top-left rounded-xl">
      <div className="hud-top-left-banner">
        <div className="hud-panel-tag">
          <Activity size={11} />
          <span>NAVCOM // FLEET LINK</span>
        </div>
        <button
          type="button"
          className={`hud-audio-mute ${audioMuted ? 'muted' : ''}`}
          onClick={() => onToggleAudioMute?.()}
          aria-pressed={Boolean(audioMuted)}
          aria-label={audioMuted ? 'Unmute fleet alerts' : 'Mute fleet alerts'}
          title={audioMuted ? 'Unmute tactical audio (volume restored)' : 'Soft mute tactical audio'}
        >
          {audioMuted ? <VolumeX size={18} strokeWidth={2.25} /> : <Volume2 size={18} strokeWidth={2.25} />}
        </button>
      </div>
      <div>
        <strong>Net</strong>
        <span className="hud-mono hud-value">{socketStatus}</span>
      </div>
      <div>
        <strong>Ships</strong>
        <span className="hud-mono hud-value">{shipsCount}</span>
      </div>
    </div>
  );
}

export function TopRightUtcHud({ utcClock }) {
  return (
    <div className="hud-panel hud-utc-card rounded-xl hud-mono" aria-live="polite">
      <div className="utc-card-label">
        <strong>UTC</strong>
      </div>
      <div className="utc-card-time">{utcClock}</div>
    </div>
  );
}

export function TopCenterHud({ windSpeed }) {
  const highWinds = Number(windSpeed ?? 0) > 30;
  return (
    <div className="hud-panel hud-top-center rounded-xl">
      <div className={`status-line ${highWinds ? 'status-caution' : ''}`}>
        <span className="status-led" />
        {highWinds ? 'CAUTION: HIGH WINDS' : 'System Status: Online'}
      </div>
    </div>
  );
}

export function BottomLeftHud({ cursorCoords }) {
  return (
    <div className="hud-panel hud-bottom-left rounded-xl hud-mono">
      <div className="hud-panel-tag" aria-hidden="true">
        <Crosshair size={11} />
        <span>CURSOR</span>
      </div>
      <div className="hud-coord-row">
        <span className="hud-coord-label">LAT</span>
        <span className="hud-coord-value">{cursorCoords[0].toFixed(4)}</span>
        <span className="hud-coord-sep" aria-hidden="true">·</span>
        <span className="hud-coord-label">LNG</span>
        <span className="hud-coord-value">{cursorCoords[1].toFixed(4)}</span>
      </div>
    </div>
  );
}

export function BottomCenterHud({ weather }) {
  const syncIso = weather?.lastSuccessfulSync || weather?.updatedAt;
  const lastSyncLabel = syncIso ? new Date(syncIso).toLocaleTimeString() : 'never';
  return (
    <div className="hud-panel hud-bottom-center rounded-xl hud-mono">
      <Globe2 size={13} className="hud-bottom-center-icon" />
      <span className="hud-readout">
        <span className="hud-readout-label">
          <Wind size={12} /> Wind
        </span>
        <span className="hud-readout-value">{(weather?.wind ?? 0).toFixed(1)} kts</span>
      </span>
      <span className="hud-readout-sep" aria-hidden="true" />
      <span className="hud-readout">
        <span className="hud-readout-label">Waves</span>
        <span className="hud-readout-value">{(weather?.waves ?? 0).toFixed(2)} m</span>
      </span>
      <span className="hud-readout-sep" aria-hidden="true" />
      <span className="hud-readout">
        <span className="hud-readout-label">Sync</span>
        <span className="hud-readout-value">{lastSyncLabel}</span>
      </span>
    </div>
  );
}

/**
 * Scrub server-side snapshots (~30s cadence, ~1 h ring). Does not pause the simulator.
 */
export function PlaybackHud({ snapshots, replayIdx, onReplayIdxChange, onLive }) {
  const n = snapshots.length;
  if (n < 1) return null;
  const max = n - 1;
  const sliderVal = replayIdx !== null ? replayIdx : max;
  const snap = replayIdx !== null ? snapshots[replayIdx] : null;
  const timeLabel =
    replayIdx === null ? 'LIVE' : snap?.iso ? new Date(snap.iso).toISOString().slice(11, 19) + 'Z' : '—';

  return (
    <div className="hud-panel hud-playback rounded-xl hud-mono" aria-label="Playback timeline">
      <span className="hud-playback-title">
        <History size={12} />
        TIMELINE
      </span>
      <input
        type="range"
        className="hud-playback-slider"
        min={0}
        max={max}
        value={sliderVal}
        onChange={(e) => onReplayIdxChange(Number(e.target.value))}
        aria-valuetext={timeLabel}
      />
      <button
        type="button"
        className={`tool-btn hud-playback-live-btn ${replayIdx === null ? 'active' : ''}`}
        onClick={onLive}
      >
        Live
      </button>
      <span className={`hud-playback-clock ${replayIdx === null ? 'hud-playback-live' : ''}`}>
        {timeLabel}
      </span>
    </div>
  );
}
