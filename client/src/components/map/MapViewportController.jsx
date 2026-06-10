import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

/**
 * Keeps Leaflet rendering stable when responsive layout changes
 * (sidebar drawer open/close, viewport switches).
 *
 * React-Leaflet only forwards MapContainer options on first mount; navigable-water
 * bounds load async — keep maxBounds / viscosity in sync here so wheel zoom and
 * pan limits behave correctly after data arrives.
 */
export function MapViewportController({
  sidebarOpen,
  isMobile,
  maxBounds,
  maxBoundsViscosity = 0.45,
}) {
  const map = useMap();

  useEffect(() => {
    map.options.maxBoundsViscosity = maxBoundsViscosity;
    if (!maxBounds || maxBounds.length !== 2) {
      return;
    }
    map.setMaxBounds(maxBounds);
  }, [map, maxBounds, maxBoundsViscosity]);

  useEffect(() => {
    const t = setTimeout(() => {
      map.invalidateSize({ pan: false, animate: false });
    }, 240);
    return () => clearTimeout(t);
  }, [isMobile, map, sidebarOpen]);

  useEffect(() => {
    const onResize = () => map.invalidateSize({ pan: false, animate: false });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [map]);

  return null;
}
