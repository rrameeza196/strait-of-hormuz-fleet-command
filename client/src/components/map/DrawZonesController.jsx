import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';

/**
 * Draw/edit restricted zones for command role.
 */
export function DrawZonesController({ userRole, zones, onCreateZone }) {
  const map = useMap();
  const layersRef = useRef([]);

  useEffect(() => {
    const pm = map.pm;
    if (!pm) return undefined;

    if (userRole === 'command') {
      pm.addControls({
        position: 'topleft',
        drawMarker: false,
        drawPolyline: false,
        drawCircle: false,
        drawCircleMarker: false,
        drawRectangle: false,
        drawText: false,
        drawPolygon: true,
        editMode: false,
        dragMode: false,
        cutPolygon: false,
        removalMode: false,
      });
      pm.setGlobalOptions({ continueDrawing: false });
    } else {
      pm.removeControls();
      pm.disableDraw();
    }

    const onCreate = (event) => {
      const feature = event.layer.toGeoJSON();
      onCreateZone(feature);
      map.removeLayer(event.layer);
    };

    map.on('pm:create', onCreate);
    return () => {
      map.off('pm:create', onCreate);
      if (pm) pm.removeControls();
    };
  }, [map, onCreateZone, userRole]);

  useEffect(() => {
    for (const layer of layersRef.current) map.removeLayer(layer);
    layersRef.current = [];

    zones.forEach((zone) => {
      const layer = L.geoJSON(zone, {
        style: {
          color: '#f43f5e',
          weight: 2,
          fillColor: '#f43f5e',
          fillOpacity: 0.15,
        },
      });
      layer.addTo(map);
      layersRef.current.push(layer);
    });
  }, [map, zones]);

  return null;
}
