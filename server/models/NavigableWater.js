import mongoose from 'mongoose';

const NavigableWaterSchema = new mongoose.Schema(
  {
    name: { type: String, default: 'Strait of Hormuz navigable corridor' },
    coordinateFormatNote: {
      type: String,
      default: 'fleet.json vertices are [lat, lng]; stored as GeoJSON Polygon [lng, lat]',
    },
    polygon: {
      type: {
        type: String,
        enum: ['Polygon'],
        default: 'Polygon',
      },
      coordinates: {
        type: [[[Number]]],
        required: true,
      },
    },
    boundingBox: {
      north: Number,
      south: Number,
      east: Number,
      west: Number,
    },
  },
  { timestamps: true }
);

export default mongoose.models.NavigableWater ||
  mongoose.model('NavigableWater', NavigableWaterSchema);
