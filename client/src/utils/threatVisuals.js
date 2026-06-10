import L from 'leaflet';

/**
 * Hollow “ghost” diamond — AIS-null track styling by proximity tier.
 * @param {number} tier 1..3 (caller filters tier < 1)
 * @param {boolean} identified
 */
export function createDarkThreatIcon(tier, identified) {
  const tierCls =
    identified ? 'identified' : tier >= 3 ? 'tier-3' : tier >= 2 ? 'tier-2' : 'tier-1';
  const flashCls = !identified && tier >= 3 ? 'dark-threat-flash' : '';

  return L.divIcon({
    className: 'dark-threat-icon-wrap',
    iconSize: [46, 46],
    iconAnchor: [23, 23],
    html: `
      <div class="dark-threat-marker ${tierCls} ${flashCls}" aria-hidden="true">
        <svg viewBox="0 0 48 48" width="42" height="42" class="dark-threat-svg">
          <polygon
            points="24,5 41,24 24,43 7,24"
            fill="rgba(15,23,42,0.35)"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linejoin="round"
          />
          <circle cx="24" cy="24" r="3" fill="currentColor" opacity="0.85" />
        </svg>
      </div>
    `,
  });
}
