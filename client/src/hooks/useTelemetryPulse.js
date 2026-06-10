import { useEffect, useRef, useState } from 'react';

export function useTelemetryPulse(ships) {
  const prevRef = useRef({});
  const [pulse, setPulse] = useState({});

  useEffect(() => {
    const nextPulse = {};

    for (const ship of ships) {
      const prev = prevRef.current[ship.shipId];
      const fuelChanged = prev ? Math.abs(prev.fuel - ship.fuel) > 0.0005 : false;
      const speedChanged = prev ? prev.speed !== ship.speed : false;

      if (fuelChanged || speedChanged) {
        nextPulse[ship.shipId] = { fuelChanged, speedChanged };
      }

      prevRef.current[ship.shipId] = { fuel: ship.fuel, speed: ship.speed };
    }

    if (Object.keys(nextPulse).length === 0) return undefined;

    setPulse((old) => ({ ...old, ...nextPulse }));
    const timeout = setTimeout(() => {
      setPulse((old) => {
        const copy = { ...old };
        for (const id of Object.keys(nextPulse)) delete copy[id];
        return copy;
      });
    }, 420);

    return () => clearTimeout(timeout);
  }, [ships]);

  return pulse;
}
