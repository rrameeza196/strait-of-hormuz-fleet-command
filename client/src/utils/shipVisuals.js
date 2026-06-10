import L from 'leaflet';

export const TYPE_LABELS = {
  cargo: 'Cargo/LNG',
  tanker: 'Tanker',
  passenger: 'Passenger/Ferry',
  security: 'Security/Patrol',
};

export function normalizeShipType(type) {
  return TYPE_LABELS[type] ? type : 'cargo';
}

export function inferShipType(ship) {
  const explicit = normalizeShipType(ship?.type);
  if (ship?.type && TYPE_LABELS[ship.type]) return explicit;

  const name = String(ship?.name || '').toLowerCase();
  const cargo = String(ship?.cargo || '').toLowerCase();
  if (name === 'jade') return 'passenger';
  if (name === 'nova') return 'security';
  if (cargo.includes('crude oil')) return 'tanker';
  return 'cargo';
}

export function shipTypeCode(type) {
  const normalized = normalizeShipType(type);
  if (normalized === 'tanker') return 'TKR';
  if (normalized === 'passenger') return 'PAX';
  if (normalized === 'security') return 'SEC';
  return 'CGO';
}

export function isCriticalStatus(status) {
  return (
    status === 'blocked' ||
    status === 'out_of_fuel' ||
    status === 'geofence_breach' ||
    status === 'stranded'
  );
}

export function statusDotClass(status) {
  if (status === 'normal') return 'dot green';
  if (status === 'proximity_warning') return 'dot orange';
  if (isCriticalStatus(status)) return 'dot red';
  return 'dot amber';
}

export function isWeatherDelayed(ship) {
  return ship?.status === 'normal' && ship?.baseSpeed > 0
    ? ship.effectiveSpeed < ship.baseSpeed * 0.7
    : false;
}

export function displayStatus(ship) {
  if (isWeatherDelayed(ship)) return 'weather delayed';
  return ship?.status ?? 'unknown';
}

export function fuelPercent(ship) {
  const maxFuelForBar = 9000;
  return Math.max(0, Math.min(100, (ship.fuel / maxFuelForBar) * 100));
}

function typeColor(type) {
  const normalized = normalizeShipType(type);
  // Brighter hues so hulls read clearly on Carto dark base tiles.
  if (normalized === 'tanker') return '#93c5fd';
  if (normalized === 'passenger') return '#5eead4';
  if (normalized === 'security') return '#c4b5fd';
  return '#67e8f9';
}

function statusColor(status, type) {
  if (status === 'proximity_warning') return '#fb923c';
  if (isCriticalStatus(status)) return '#fb7185';
  return typeColor(type);
}

function hexToRgba(hex, alpha) {
  const clean = hex.replace('#', '');
  const bigint = Number.parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function silhouettePath(type) {
  const normalized = normalizeShipType(type);
  if (normalized === 'tanker') return 'M50 5 L59 10 L64 22 L64 84 L36 84 L36 22 L41 10 Z';
  if (normalized === 'passenger') return 'M50 6 L60 12 L68 30 L62 76 L38 76 L32 30 L40 12 Z';
  if (normalized === 'security') return 'M50 4 L62 12 L70 30 L62 74 L50 94 L38 74 L30 30 L38 12 Z';
  return 'M50 5 L60 11 L67 28 L62 80 L38 80 L33 28 L40 11 Z';
}

export function createShipIcon(
  heading,
  status,
  highlighted,
  distressPulse = false,
  type = 'cargo',
  dimmed = false,
  commandAnchor = false,
  commandTarget = false
) {
  const toneClass =
    status === 'proximity_warning'
      ? 'warning'
      : isCriticalStatus(status)
        ? 'alert'
        : 'normal';
  const highlightedClass = highlighted ? 'highlighted' : '';
  const distressPulseClass = distressPulse ? 'distress-pulse' : '';
  const dimmedClass = dimmed ? 'dimmed' : '';
  const commandAnchorClass = commandAnchor ? 'command-anchor' : '';
  const commandTargetClass = commandTarget ? 'command-target' : '';
  const resolvedType = normalizeShipType(type);
  const stroke = statusColor(status, resolvedType);
  const fill = hexToRgba(stroke, 0.38);
  const shipPath = silhouettePath(resolvedType);
  const bridgeFill = hexToRgba(stroke, 0.42);

  return L.divIcon({
    className: 'ship-icon-wrap',
    iconSize: [52, 52],
    iconAnchor: [26, 26],
    html: `
      <div class="ship-marker ${toneClass} type-${resolvedType} ${highlightedClass} ${distressPulseClass} ${dimmedClass} ${commandAnchorClass} ${commandTargetClass}">
        <div class="ship-visibility-ring" aria-hidden="true"></div>
        <div class="ship-pulse"></div>
        <div class="ship-rotation" style="transform: rotate(${heading}deg)">
          <svg viewBox="0 0 100 100" class="ship-svg" aria-hidden="true">
            <path d="${shipPath}" class="ship-hull-outline"></path>
            <path d="${shipPath}" class="ship-hull" style="stroke: ${stroke}; fill: ${fill};"></path>
            <rect x="41" y="42" width="18" height="12" rx="2" class="ship-bridge" style="fill: ${bridgeFill}; stroke: ${stroke};"></rect>
            <path d="M40 58 L60 58" class="ship-deck" style="stroke: ${stroke};"></path>
            <path d="M43 67 L57 67" class="ship-deck" style="stroke: ${stroke}; opacity: 0.6;"></path>
            <circle cx="50" cy="22" r="2.8" class="ship-nav-light"></circle>
          </svg>
        </div>
      </div>
    `,
  });
}
