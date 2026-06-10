import { useEffect, useMemo, useState } from 'react';
import {
  Gauge,
  Navigation,
  Radar,
  Ship as ShipIcon,
  Waves,
  ShieldAlert,
  Cpu,
  AlertTriangle,
  Activity,
} from 'lucide-react';
import { motion } from 'framer-motion';
import {
  displayStatus,
  fuelPercent,
  isCriticalStatus,
  isWeatherDelayed,
  shipTypeCode,
  statusDotClass,
  TYPE_LABELS,
  inferShipType,
} from '../../utils/shipVisuals';

function operationalChannelLabel(channel) {
  if (channel === 'fleet_advisor') return 'Advisor';
  if (channel === 'distress') return 'Distress';
  return 'Security';
}

function formatUtcHm(ts) {
  try {
    return `${new Date(ts).toISOString().slice(11, 19)}Z`;
  } catch {
    return '—';
  }
}

const DISTRESS_SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

export function CommandSidebar({
  ships,
  threats = [],
  radarContactMemory = {},
  operationalLog = [],
  onClearOperationalLog,
  onDismissRecommendation,
  selectedShipId,
  selectedDarkThreatId = '',
  onFocusThreat,
  onSelectShip,
  setHoveredShipId,
  telemetryPulse,
  socketStatus,
  userRole,
  captainShipId,
  onCaptainShipChange,
  distressMessage,
  onDistressChange,
  onSendDistress,
  allShips = ships,
  typeFilter,
  onTypeFilterChange,
  latestRecommendation,
  onApplyRecommendation,
  zones = [],
  onDeleteZone,
  onCaptainAcceptCourse,
  replayActive = false,
  isMobile,
  onCloseMobile,
}) {
  const [sidebarTab, setSidebarTab] = useState('fleet');

  const securityContacts = useMemo(() => {
    return (threats || [])
      .filter((t) => t.tier >= 1)
      .slice()
      .sort((a, b) => (Number(a.distanceKm) || 999) - (Number(b.distanceKm) || 999));
  }, [threats]);

  const droppedRadarContacts = useMemo(() => {
    return Object.values(radarContactMemory || {})
      .filter((e) => (e.tier ?? 0) < 1 && (e.maxTier ?? 0) >= 1)
      .sort((a, b) => (b.droppedAt || 0) - (a.droppedAt || 0));
  }, [radarContactMemory]);

  const showFleetTabBody = userRole !== 'command' || sidebarTab === 'fleet';
  const showTypeFilters = showFleetTabBody;

  const selectedShipDetail = useMemo(
    () => (selectedShipId ? allShips.find((s) => s.shipId === selectedShipId) ?? null : null),
    [allShips, selectedShipId]
  );

  const prioritizedOperationalLog = useMemo(() => {
    const distress = operationalLog.filter((e) => e.channel === 'distress');
    const rest = operationalLog.filter((e) => e.channel !== 'distress');
    distress.sort((a, b) => {
      const ra = DISTRESS_SEVERITY_RANK[a.severity] ?? 1;
      const rb = DISTRESS_SEVERITY_RANK[b.severity] ?? 1;
      if (rb !== ra) return rb - ra;
      return b.receivedAt - a.receivedAt;
    });
    rest.sort((a, b) => b.receivedAt - a.receivedAt);
    return [...distress, ...rest];
  }, [operationalLog]);

  // Aggregated visual digest (purely derived — no state changes, no side effects).
  const criticalShipsCount = useMemo(
    () => ships.filter((s) => isCriticalStatus(s.status)).length,
    [ships]
  );
  const radarContactsCount = securityContacts.length;
  const advisoryActive = latestRecommendation ? 1 : 0;
  const logCount = operationalLog.length;
  const alertsTabCount = advisoryActive + logCount;
  const isCommand = userRole === 'command';

  useEffect(() => {
    if (userRole === 'command' && selectedShipId) {
      setSidebarTab('fleet');
    }
  }, [selectedShipId, userRole]);

  const showControlsZone =
    userRole === 'command' || showTypeFilters || userRole === 'captain';

  return (
    <aside className="sidebar rounded-xl">
      {/* === Classification strip ============================================ */}
      <div className="sidebar-classification" aria-hidden="true">
        <span>// CLASSIFIED</span>
        <span>NAVCOM-TACTICAL-CONSOLE</span>
        <span>// {String(userRole || 'command').toUpperCase()}</span>
      </div>

      {/* === ZONE 1 — Command header ========================================= */}
      <section
        className="sidebar-zone sidebar-zone--header"
        aria-label="Command header"
      >
        <div className="sidebar-header">
          <span className="sidebar-title">
            <Waves size={16} />
            Command Sidebar
          </span>
          <span className="sidebar-right">
            <ShipIcon size={16} /> {ships.length}
          </span>
          {isMobile ? (
            <button type="button" className="tool-btn mobile-only" onClick={onCloseMobile}>
              Close
            </button>
          ) : null}
        </div>
        {userRole === 'captain' ? (
          <div className="captain-controls">
            <label htmlFor="captainShipSelect">Select Your Ship</label>
            <select
              id="captainShipSelect"
              value={captainShipId}
              onChange={(e) => onCaptainShipChange(e.target.value)}
            >
              <option value="">-- choose ship --</option>
              {allShips.map((s) => (
                <option key={s.shipId} value={s.shipId}>
                  {s.name} ({s.shipId})
                </option>
              ))}
            </select>
            <label htmlFor="distressSignal">Distress Signal</label>
            <textarea
              id="distressSignal"
              rows={2}
              placeholder="Free-form distress message (escalates to command / AI)..."
              value={distressMessage}
              onChange={(e) => onDistressChange(e.target.value)}
            />
            <div className="captain-action-row">
              <button
                type="button"
                className="tool-btn captain-accept-btn"
                onClick={() => onCaptainAcceptCourse?.()}
                disabled={!captainShipId}
              >
                Accept assigned course
              </button>
              <button
                type="button"
                className="tool-btn"
                onClick={onSendDistress}
                disabled={!captainShipId || !distressMessage.trim()}
              >
                Escalate distress (AI)
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {/* === ZONE 2 — System alert digest (always-on situational summary) === */}
      <section
        className="sidebar-zone sidebar-zone--alerts"
        aria-label="System alert digest"
      >
        <div className="alert-digest-heading">
          <span>System Alert Digest</span>
          <span className="alert-digest-tick" aria-hidden="true" />
        </div>
        <div className="alert-digest-row" role="group" aria-label="Live alert counts">
          <div
            className={`alert-digest-pill alert-digest-critical ${criticalShipsCount > 0 ? 'on' : ''}`}
            title="Vessels in critical status"
          >
            <span className="alert-digest-icon">
              <AlertTriangle size={11} />
            </span>
            <span className="alert-digest-label">Critical</span>
            <span className="alert-digest-count">{criticalShipsCount}</span>
          </div>
          <div
            className={`alert-digest-pill alert-digest-radar ${radarContactsCount > 0 ? 'on' : ''}`}
            title="Unidentified contacts inside radar envelope"
          >
            <span className="alert-digest-icon">
              <Radar size={11} />
            </span>
            <span className="alert-digest-label">Radar</span>
            <span className="alert-digest-count">{radarContactsCount}</span>
          </div>
          <div
            className={`alert-digest-pill alert-digest-advisory ${advisoryActive ? 'on' : ''}`}
            title="Active AI advisory"
          >
            <span className="alert-digest-icon">
              <Cpu size={11} />
            </span>
            <span className="alert-digest-label">AI</span>
            <span className="alert-digest-count">{advisoryActive}</span>
          </div>
          <div
            className={`alert-digest-pill alert-digest-log ${logCount > 0 ? 'on' : ''}`}
            title="Operational log entries"
          >
            <span className="alert-digest-icon">
              <Activity size={11} />
            </span>
            <span className="alert-digest-label">Log</span>
            <span className="alert-digest-count">{logCount}</span>
          </div>
        </div>
      </section>

      {/* === ZONE 3 — Fleet / Security controls ============================= */}
      {showControlsZone ? (
        <section
          className="sidebar-zone sidebar-zone--controls"
          aria-label="Fleet and security controls"
        >
          {isCommand ? (
            <div className="sidebar-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={sidebarTab === 'fleet'}
                className={`sidebar-tab ${sidebarTab === 'fleet' ? 'active' : ''}`}
                onClick={() => setSidebarTab('fleet')}
              >
                Fleet
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sidebarTab === 'security'}
                className={`sidebar-tab ${sidebarTab === 'security' ? 'active' : ''}`}
                onClick={() => setSidebarTab('security')}
              >
                Security
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sidebarTab === 'alerts'}
                className={`sidebar-tab sidebar-tab--alerts ${sidebarTab === 'alerts' ? 'active' : ''} ${alertsTabCount > 0 ? 'has-alerts' : ''}`}
                onClick={() => setSidebarTab('alerts')}
              >
                <span className="sidebar-tab-label">Alerts</span>
                {alertsTabCount > 0 ? (
                  <span className="sidebar-tab-badge" aria-label={`${alertsTabCount} pending alerts`}>
                    {alertsTabCount > 99 ? '99+' : alertsTabCount}
                  </span>
                ) : null}
              </button>
            </div>
          ) : null}

          {showTypeFilters ? (
            <div className="type-filter-row">
              {[
                { id: 'all', label: 'All' },
                { id: 'cargo', label: 'Cargo' },
                { id: 'tanker', label: 'Tanker' },
                { id: 'passenger', label: 'Passenger' },
              ].map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  className={`type-chip ${typeFilter === chip.id ? 'active' : ''}`}
                  onClick={() => onTypeFilterChange(chip.id)}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* === ZONE 4 — Operational Data (tab-driven) — PROTECTED ============= */}
      <section
        className={`sidebar-zone sidebar-zone--fleet sidebar-zone--tab-${isCommand ? sidebarTab : 'fleet'}`}
        aria-label="Operational data"
      >
        <div className="sidebar-zone-title" aria-hidden="true">
          <span className="sidebar-zone-title-bar" />
          <span className="sidebar-zone-title-text">
            {isCommand && sidebarTab === 'security'
              ? 'Security · Contact Registry'
              : isCommand && sidebarTab === 'alerts'
                ? 'Command Alerts · Advisories & Log'
                : 'Fleet Roster · Operational Data'}
          </span>
          {isCommand && sidebarTab === 'alerts' && alertsTabCount > 0 ? (
            <span className="sidebar-zone-title-meta">{alertsTabCount} active</span>
          ) : null}
          {(!isCommand || sidebarTab === 'fleet') ? (
            <span className="sidebar-zone-title-meta">{ships.length} hulls</span>
          ) : null}
        </div>

        {userRole === 'command' && sidebarTab === 'fleet' && selectedShipDetail ? (
          <div className="fleet-vessel-detail-panel rounded-xl">
            <div className="fleet-vessel-detail-head">
              <span className="fleet-vessel-detail-title">{selectedShipDetail.name}</span>
              <button
                type="button"
                className="fleet-vessel-detail-close"
                aria-label="Clear vessel selection"
                onClick={() => onSelectShip?.('')}
              >
                ×
              </button>
            </div>
            <p className="fleet-vessel-detail-sub">
              Full readout — select another hull from the map or list below.
            </p>
            <dl className="fleet-vessel-detail-dl">
              <div className="fleet-vessel-detail-row">
                <dt>Type</dt>
                <dd>
                  [{shipTypeCode(inferShipType(selectedShipDetail))}]{' '}
                  {TYPE_LABELS[inferShipType(selectedShipDetail)] || TYPE_LABELS.cargo}
                </dd>
              </div>
              <div className="fleet-vessel-detail-row">
                <dt>Status</dt>
                <dd>
                  <span
                    className={`fleet-vessel-detail-status ${isCriticalStatus(selectedShipDetail.status) ? 'critical' : ''}`}
                  >
                    {displayStatus(selectedShipDetail)}
                  </span>
                </dd>
              </div>
              <div className="fleet-vessel-detail-row">
                <dt>Speed</dt>
                <dd
                  className={telemetryPulse[selectedShipDetail.shipId]?.speedChanged ? 'telemetry-flash' : ''}
                >
                  {selectedShipDetail.speed.toFixed(1)} kn
                </dd>
              </div>
              <div className="fleet-vessel-detail-row">
                <dt>Fuel</dt>
                <dd
                  className={telemetryPulse[selectedShipDetail.shipId]?.fuelChanged ? 'telemetry-flash' : ''}
                >
                  {selectedShipDetail.fuel.toFixed(1)} t
                </dd>
              </div>
              <div className="fleet-vessel-detail-fueltrack">
                <div
                  className="fuel-fill"
                  style={{ transform: `scaleX(${fuelPercent(selectedShipDetail) / 100})` }}
                />
              </div>
              <div className="fleet-vessel-detail-row">
                <dt>Env. drag</dt>
                <dd>-{(selectedShipDetail.envDrag ?? selectedShipDetail.envDragKnots ?? 0).toFixed(2)} kn</dd>
              </div>
              <div className="fleet-vessel-detail-row">
                <dt>Destination</dt>
                <dd>{selectedShipDetail.destination}</dd>
              </div>
              <div className="fleet-vessel-detail-row">
                <dt>Cargo</dt>
                <dd>{selectedShipDetail.cargo}</dd>
              </div>
            </dl>
          </div>
        ) : null}

        {userRole === 'command' && sidebarTab === 'fleet' && zones?.length > 0 ? (
          <div className="restricted-zones-panel rounded-xl">
            <div className="restricted-zones-heading">Restricted zones (draw on map)</div>
            <ul className="restricted-zones-list">
              {zones.map((z) => (
                <li key={z.id} className="restricted-zones-row">
                  <span className="restricted-zones-id hud-mono" title={z.id}>
                    {z.id}
                  </span>
                  {onDeleteZone ? (
                    <button
                      type="button"
                      className="restricted-zones-delete"
                      onClick={() => onDeleteZone(z.id)}
                    >
                      Delete
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {replayActive ? (
          <p className="replay-banner hud-mono" role="status">
            Playback: historical snapshot (~30s cadence). Socket feed continues — press Live on the map to exit.
          </p>
        ) : null}

        {isCommand && sidebarTab === 'alerts' ? (
          <div className="alerts-tab-pane" role="region" aria-label="Command alerts">
            {latestRecommendation ? (
              <div className="ai-recommendation-panel ai-recommendation-panel--in-tab">
                <div className="ai-reco-title">
                  <Cpu size={11} />
                  <span>AI Recommendation</span>
                </div>
                <div className="ai-reco-main">
                  Severity: {(latestRecommendation.severity || 'medium').toUpperCase()} | Type:{' '}
                  {latestRecommendation.type || 'general'}
                </div>
                <div className="ai-reco-summary">
                  {latestRecommendation.summary || 'Distress advisory generated by AI.'}
                </div>
                <div className="ai-reco-action">
                  {latestRecommendation.suggestedAction || 'Monitor situation and coordinate support.'}
                </div>
                <div className="ai-reco-actions">
                  {latestRecommendation.shipId ? (
                    <button
                      type="button"
                      className="tool-btn"
                      onClick={() => onApplyRecommendation(latestRecommendation)}
                    >
                      Apply AI Recommendation
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="tool-btn ai-reco-dismiss"
                    onClick={() => onDismissRecommendation?.()}
                  >
                    Dismiss banner
                  </button>
                </div>
              </div>
            ) : null}

            {operationalLog.length > 0 ? (
              <div className="operational-log-panel operational-log-panel--in-tab">
                <div className="operational-log-header">
                  <span className="operational-log-title">Operational message log</span>
                  <button
                    type="button"
                    className="operational-log-clear"
                    onClick={() => onClearOperationalLog?.()}
                  >
                    Clear log
                  </button>
                </div>
                <p className="operational-log-hint">
                  Persistent record of advisor, distress, and security traffic (most recent at top).
                </p>
                <ul className="operational-log-list">
                  {prioritizedOperationalLog.map((entry) => (
                    <li key={entry.id} className="operational-log-row">
                      <span className="operational-log-time">{formatUtcHm(entry.receivedAt)}</span>
                      <span
                        className={`operational-log-chip operational-log-chip-${String(entry.channel).replace(/_/g, '-')}`}
                      >
                        {operationalChannelLabel(entry.channel)}
                      </span>
                      <span className="operational-log-main">
                        {entry.channel === 'distress' && entry.severity ? (
                          <span
                            className={`operational-log-severity operational-log-severity-${entry.severity}`}
                          >
                            {String(entry.severity).toUpperCase()}
                            {typeof entry.injuries === 'number' && entry.injuries > 0
                              ? ` · ${entry.injuries} inj`
                              : ''}
                          </span>
                        ) : null}
                        <span className="operational-log-summary">{entry.summaryLine}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {!latestRecommendation && operationalLog.length === 0 ? (
              <div className="alerts-empty-state" role="status">
                <ShieldAlert size={22} aria-hidden="true" />
                <strong>No active alerts</strong>
                <span>
                  Advisories, distress signals, and operational log entries will appear here.
                </span>
              </div>
            ) : null}
          </div>
        ) : userRole === 'command' && sidebarTab === 'security' ? (
          <div className="security-panel">
            <div className="security-panel-heading">
              <ShieldAlert size={13} />
              <span>Nearby unidentified contacts</span>
            </div>
            <p className="security-panel-hint">
              Contacts appear when inside any friendly vessel&apos;s ~10 km radar envelope.
            </p>
            <div className="security-panel-subheading">Active (inside radar envelope)</div>
            <ul className="security-contact-list">
              {securityContacts.length === 0 ? (
                <li className="security-contact-empty">No active radar contacts.</li>
              ) : (
                securityContacts.map((t) => (
                  <li key={t.threatId}>
                    <button
                      type="button"
                      className={`security-contact-btn rounded-xl ${selectedDarkThreatId === t.threatId ? 'active' : ''}`}
                      onClick={() => onFocusThreat?.(t.threatId)}
                    >
                      <span className="security-contact-title">
                        {t.identified ? t.aiLabel || 'Identified threat' : 'UNIDENTIFIED'}
                      </span>
                      <span className="security-contact-meta">
                        {t.threatId} · {Number(t.distanceKm ?? 0).toFixed(2)} km · Tier {t.tier}
                        {t.closestFriendlyShipId ? ` · nearest ${t.closestFriendlyShipId}` : ''}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
            {droppedRadarContacts.length > 0 ? (
              <>
                <div className="security-panel-subheading dropped">Recent — outside envelope</div>
                <p className="security-panel-hint security-panel-hint-tight">
                  Contacts remain listed for 45 minutes after Tier drops below 1 (lost radar closure).
                </p>
                <ul className="security-contact-list">
                  {droppedRadarContacts.map((mem) => (
                    <li key={`dropped-${mem.threatId}`}>
                      <button
                        type="button"
                        className={`security-contact-btn security-contact-dropped rounded-xl ${selectedDarkThreatId === mem.threatId ? 'active' : ''}`}
                        onClick={() => onFocusThreat?.(mem.threatId)}
                      >
                        <span className="security-contact-title">
                          {mem.identified ? mem.aiLabel || 'Identified threat' : 'UNIDENTIFIED'}{' '}
                          <span className="security-dropped-badge">track retained</span>
                        </span>
                        <span className="security-contact-meta">
                          {mem.threatId} · last {Number(mem.distanceKm ?? 0).toFixed(2)} km · was Tier{' '}
                          {mem.maxTier}
                          {mem.closestFriendlyShipId ? ` · nearest ${mem.closestFriendlyShipId}` : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : (
          <ul className="ship-list">
            {ships.map((ship) => {
              const resolvedType = inferShipType(ship);
              return (
                <motion.li
                  key={ship.shipId}
                  initial={{ opacity: 0.7 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                >
                  <button
                    type="button"
                    className={`ship-btn rounded-xl ${selectedShipId === ship.shipId ? 'active' : ''}`}
                    onClick={() => onSelectShip(ship.shipId)}
                    onMouseEnter={() => setHoveredShipId(ship.shipId)}
                    onMouseLeave={() => {
                      if (selectedShipId === ship.shipId) return;
                      setHoveredShipId('');
                    }}
                  >
                    <div className="ship-top">
                      <span className="ship-name">
                        {ship.name}{' '}
                        <span className="ship-type-tag">
                          [{TYPE_LABELS[resolvedType] || TYPE_LABELS.cargo}]
                        </span>
                      </span>
                      <span
                        className={`status-chip ${isCriticalStatus(ship.status) ? 'critical' : ''} ${isWeatherDelayed(ship) ? 'weather-delayed' : ''}`}
                      >
                        <span className={statusDotClass(isWeatherDelayed(ship) ? 'rerouting' : ship.status)} />
                        {displayStatus(ship)}
                      </span>
                    </div>

                    <div className="telemetry-row">
                      <span className="telemetry-label">
                        <Navigation size={12} /> Fuel
                      </span>
                      <span
                        className={`telemetry-value ${telemetryPulse[ship.shipId]?.fuelChanged ? 'telemetry-flash' : ''}`}
                      >
                        {ship.fuel.toFixed(1)} t
                      </span>
                    </div>
                    <div className="fuel-track">
                      <div
                        className="fuel-fill"
                        style={{ transform: `scaleX(${fuelPercent(ship) / 100})` }}
                      />
                    </div>

                    <div className="telemetry-row">
                      <span className="telemetry-label">
                        <Gauge size={12} /> Speed
                      </span>
                      <span
                        className={`telemetry-value ${telemetryPulse[ship.shipId]?.speedChanged ? 'telemetry-flash' : ''}`}
                      >
                        {ship.speed.toFixed(1)} kn
                      </span>
                    </div>
                  </button>
                </motion.li>
              );
            })}
          </ul>
        )}
      </section>

      {/* === ZONE 5 — AI Recommendations (captain only — command uses Alerts tab) === */}
      {!isCommand && latestRecommendation ? (
        <section
          className="sidebar-zone sidebar-zone--recommendation"
          aria-label="AI recommendation"
        >
          <div className="ai-recommendation-panel">
            <div className="ai-reco-title">
              <Cpu size={11} />
              <span>AI Recommendation</span>
            </div>
            <div className="ai-reco-main">
              Severity: {(latestRecommendation.severity || 'medium').toUpperCase()} | Type:{' '}
              {latestRecommendation.type || 'general'}
            </div>
            <div className="ai-reco-summary">
              {latestRecommendation.summary || 'Distress advisory generated by AI.'}
            </div>
            <div className="ai-reco-action">
              {latestRecommendation.suggestedAction || 'Monitor situation and coordinate support.'}
            </div>
            <div className="ai-reco-actions">
              {latestRecommendation.shipId ? (
                <button
                  type="button"
                  className="tool-btn"
                  onClick={() => onApplyRecommendation(latestRecommendation)}
                >
                  Apply AI Recommendation
                </button>
              ) : null}
              <button
                type="button"
                className="tool-btn ai-reco-dismiss"
                onClick={() => onDismissRecommendation?.()}
              >
                Dismiss banner
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {/* === ZONE 6 — Operational Logs (captain only — command uses Alerts tab) === */}
      {!isCommand && operationalLog.length > 0 ? (
        <section
          className="sidebar-zone sidebar-zone--log"
          aria-label="Operational message log"
        >
          <div className="operational-log-panel">
            <div className="operational-log-header">
              <span className="operational-log-title">Operational message log</span>
              <button
                type="button"
                className="operational-log-clear"
                onClick={() => onClearOperationalLog?.()}
              >
                Clear log
              </button>
            </div>
            <p className="operational-log-hint">
              Persistent record of advisor, distress, and security traffic (most recent at top).
            </p>
            <ul className="operational-log-list">
              {prioritizedOperationalLog.map((entry) => (
                <li key={entry.id} className="operational-log-row">
                  <span className="operational-log-time">{formatUtcHm(entry.receivedAt)}</span>
                  <span
                    className={`operational-log-chip operational-log-chip-${String(entry.channel).replace(/_/g, '-')}`}
                  >
                    {operationalChannelLabel(entry.channel)}
                  </span>
                  <span className="operational-log-main">
                    {entry.channel === 'distress' && entry.severity ? (
                      <span
                        className={`operational-log-severity operational-log-severity-${entry.severity}`}
                      >
                        {String(entry.severity).toUpperCase()}
                        {typeof entry.injuries === 'number' && entry.injuries > 0
                          ? ` · ${entry.injuries} inj`
                          : ''}
                      </span>
                    ) : null}
                    <span className="operational-log-summary">{entry.summaryLine}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {/* === ZONE 7 — Persistent status footer ============================== */}
      <footer className="sidebar-zone sidebar-zone--footer">
        <div className="sidebar-footer hud-mono">
          <Radar size={13} /> Tactical sync {socketStatus}
        </div>
      </footer>
    </aside>
  );
}
