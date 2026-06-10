import { useMapEvents } from 'react-leaflet';

export function CursorHudController({ onMove }) {
  useMapEvents({
    mousemove: (event) => {
      onMove([event.latlng.lat, event.latlng.lng]);
    },
  });

  return null;
}
