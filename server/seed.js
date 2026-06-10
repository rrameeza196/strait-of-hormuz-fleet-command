import 'dotenv/config';
import mongoose from 'mongoose';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Ship from './models/Ship.js';
import NavigableWater from './models/NavigableWater.js';
import Port from './models/Port.js';
import FleetConfig from './models/FleetConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function latLngRingToGeoJSON(latLngRing) {
  const ring = latLngRing.map(([lat, lng]) => [lng, lat]);
  const [firstLng, firstLat] = ring[0];
  const [lastLng, lastLat] = ring[ring.length - 1];
  if (firstLng !== lastLng || firstLat !== lastLat) {
    ring.push([firstLng, firstLat]);
  }
  return [ring];
}

async function loadFleetData() {
  const fleetPath = path.join(__dirname, 'data', 'fleet.json');
  const raw = await readFile(fleetPath, 'utf8');
  return JSON.parse(raw);
}

async function seed() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set.');
    process.exit(1);
  }

  await mongoose.connect(uri);

  const alreadySeeded = await NavigableWater.findOne().lean();
  if (alreadySeeded?.polygon?.coordinates?.length) {
    console.log('[Seed] Database already initialized — skipping.');
    await mongoose.disconnect();
    return;
  }

  const data = await loadFleetData();

  await Ship.deleteMany({});
  await NavigableWater.deleteMany({});
  await Port.deleteMany({});
  await FleetConfig.deleteMany({});

  const ships = data.fleet.map((s) => {
    const [lat, lng] = s.position;
    return {
      shipId: s.shipId,
      name: s.name,
      location: {
        type: 'Point',
        coordinates: [lng, lat],
      },
      speed: s.speed,
      heading: s.heading,
      destination: s.destination,
      fuel: s.fuel,
      cargo: s.cargo,
      type: s.type || 'cargo',
      status: s.status,
    };
  });

  await Ship.insertMany(ships);

  const ports = data.ports.map((p) => {
    const [lat, lng] = p.position;
    return {
      portId: p.id,
      name: p.name,
      location: {
        type: 'Point',
        coordinates: [lng, lat],
      },
    };
  });

  await Port.insertMany(ports);

  await FleetConfig.create({
    scenario: {
      name: data.scenario?.name || 'Fleet scenario',
      description: data.scenario?.description ?? '',
    },
    coordinateFormat: data.coordinateFormat ?? '[lat, lng]',
    units: {
      speed: data.units?.speed ?? 'knots',
      fuel: data.units?.fuel ?? 'tons',
      heading:
        data.units?.heading ?? 'degrees from true north (0-360)',
    },
  });

  await NavigableWater.create({
    name: data.scenario?.name || 'Navigable water',
    polygon: {
      type: 'Polygon',
      coordinates: latLngRingToGeoJSON(data.navigableWater),
    },
    boundingBox: data.boundingBox,
  });

  console.log(
    `Seeded ${ships.length} ships, ${ports.length} ports, fleet config, and navigable water.`
  );
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
