import mongoose from 'mongoose';

/**
 * Singleton-style document mirroring fleet.json top-level metadata
 * (scenario, coordinateFormat, units). Polygon + bbox live on NavigableWater.
 */
const FleetConfigSchema = new mongoose.Schema(
  {
    scenario: {
      name: { type: String, required: true },
      description: { type: String, default: '' },
    },
    coordinateFormat: { type: String, default: '[lat, lng]' },
    units: {
      speed: { type: String, default: 'knots' },
      fuel: { type: String, default: 'tons' },
      heading: { type: String, default: 'degrees from true north (0-360)' },
    },
  },
  { timestamps: true }
);

export default mongoose.models.FleetConfig ||
  mongoose.model('FleetConfig', FleetConfigSchema);
