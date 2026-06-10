import { memo, useMemo } from 'react';
import { Marker, Popup } from 'react-leaflet';
import {
  createShipIcon,
  inferShipType,
  shipTypeCode,
  TYPE_LABELS,
} from '../../utils/shipVisuals';

export const ShipMarker = memo(function ShipMarker({
  ship,
  markerRefs,
  highlighted,
  distressPulse,
  dimmed,
  commandAnchor,
  commandTarget,
  onSelectShip,
  /** COMMAND mode: vessel specs live in sidebar only (no Leaflet popup). */
  suppressPopup = false,
}) {
  const resolvedType = inferShipType(ship);
  const icon = useMemo(
    () =>
      createShipIcon(
        ship.heading,
        ship.status,
        highlighted,
        distressPulse,
        resolvedType,
        dimmed,
        Boolean(commandAnchor),
        Boolean(commandTarget)
      ),
    [
      ship.heading,
      ship.status,
      highlighted,
      distressPulse,
      resolvedType,
      dimmed,
      commandAnchor,
      commandTarget,
    ]
  );

  return (
    <Marker
      ref={(node) => {
        if (node) markerRefs.current[ship.shipId] = node;
      }}
      position={ship.position}
      icon={icon}
      eventHandlers={{
        click: () => {
          onSelectShip(ship.shipId);
        },
      }}
    >
      {!suppressPopup ? (
        <Popup>
          <strong>{ship.name}</strong>
          <br />
          Type: [{shipTypeCode(resolvedType)}] {TYPE_LABELS[resolvedType] || TYPE_LABELS.cargo}
          <br />
          Status: {ship.status}
          <br />
          Speed: {ship.speed} kn
          <br />
          Fuel: {ship.fuel.toFixed(1)} t
          <br />
          Env. Drag: -{(ship.envDrag ?? ship.envDragKnots ?? 0).toFixed(2)} kn
          <br />
          Destination: {ship.destination}
          <br />
          Cargo: {ship.cargo}
        </Popup>
      ) : null}
    </Marker>
  );
});
