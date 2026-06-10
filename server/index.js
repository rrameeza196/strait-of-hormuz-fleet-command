import 'dotenv/config';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import * as turf from '@turf/turf';
import Ship from './models/Ship.js';
import NavigableWater from './models/NavigableWater.js';
import Port from './models/Port.js';
import { resolveCorsOrigins } from './config/cors.config.js';
import { createHealthRouter } from './routes/health.routes.js';
import { createNavigableWaterRouter } from './routes/navigable-water.routes.js';
import { createShipsRouter } from './routes/ships.routes.js';
import { createZonesRouter } from './routes/zones.routes.js';
import { createDistressRouter } from './routes/distress.routes.js';
import { createThreatsRouter } from './routes/threats.routes.js';
import { createHistoryRouter } from './routes/history.routes.js';
import { Simulator } from './services/Simulator.js';
import { GeminiService } from './services/GeminiService.js';

const PORT = Number(process.env.PORT) || 5050;
const MONGO_URI = process.env.MONGO_URI;
const allowedOrigins = resolveCorsOrigins();

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {{ shadowFleet?: unknown[] } | null} */
let shadowFleetConfig = null;
try {
  shadowFleetConfig = JSON.parse(
    readFileSync(join(__dirname, 'data/threats.json'), 'utf8')
  );
} catch (err) {
  console.warn('[Boot] Could not load data/threats.json — shadow fleet disabled:', err.message);
}

const app = express();
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

async function main() {
  if (!MONGO_URI) {
    console.error('Missing MONGO_URI in environment.');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log('MongoDB connected');

  const nwDoc = await NavigableWater.findOne().lean();
  if (!nwDoc?.polygon?.coordinates) {
    console.error('NavigableWater not seeded. Run: npm run seed');
    process.exit(1);
  }

  const navigable = turf.polygon(nwDoc.polygon.coordinates);

  const shipDocs = await Ship.find({}).sort({ shipId: 1 }).exec();
  if (shipDocs.length !== 15) {
    console.warn(
      `[Boot] Expected 15 ships in DB, found ${shipDocs.length}. Run: npm run seed`
    );
  }

  const portDocs = await Port.find({}).lean();
  const portsById = {};
  for (const port of portDocs) {
    portsById[port.portId] = {
      lng: port.location.coordinates[0],
      lat: port.location.coordinates[1],
    };
  }

  const ramShips = Simulator.fromDocuments(shipDocs);
  const simulator = new Simulator({
    io,
    navigable,
    ships: ramShips,
    portsById,
    shadowFleetConfig,
  });
  const geminiService = new GeminiService();

  io.on('connection', (socket) => {
    socket.emit('connected', { message: 'fleet channel ready' });
    socket.emit('zones-updated', simulator.getZonesPayload());
  });

  app.use(createHealthRouter());
  app.use('/api/ships', createShipsRouter(simulator));
  app.use('/api/navigable-water', createNavigableWaterRouter(nwDoc));
  app.use('/api/zones', createZonesRouter(simulator));
  app.use('/api/distress', createDistressRouter(geminiService, io, simulator));
  app.use('/api/threats', createThreatsRouter(simulator, geminiService));
  app.use('/api/history', createHistoryRouter(simulator));

  simulator.start();

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`HTTP + Socket.io listening on port ${PORT}`);
    console.log(`CORS: ${allowedOrigins.join(', ')}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
