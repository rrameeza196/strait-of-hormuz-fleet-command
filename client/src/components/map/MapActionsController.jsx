import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

/**
 * Registers imperative map actions using a guaranteed map instance from useMap().
 */
export function MapActionsController({ onReady }) {
  const map = useMap();

  useEffect(() => {
    onReady(map);
    return () => onReady(null);
  }, [map, onReady]);

  return null;
}
