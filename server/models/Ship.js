import mongoose from 'mongoose';

const ShipSchema = new mongoose.Schema(
  {
    shipId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },
    speed: { type: Number, required: true },
    heading: { type: Number, required: true },
    destination: { type: String, required: true },
    fuel: { type: Number, required: true },
    cargo: { type: String, required: true },
    type: {
      type: String,
      enum: ['cargo', 'tanker', 'passenger', 'security'],
      default: 'cargo',
      required: true,
    },
    status: { type: String, required: true, default: 'normal' },
  },
  { timestamps: true }
);

ShipSchema.index({ location: '2dsphere' });

function fleetShape(o) {
  const [lng, lat] = o.location.coordinates;
  return {
    shipId: o.shipId,
    name: o.name,
    position: [lat, lng],
    speed: o.speed,
    heading: o.heading,
    destination: o.destination,
    fuel: o.fuel,
    cargo: o.cargo,
    type: o.type,
    status: o.status,
    updatedAt: o.updatedAt,
  };
}

ShipSchema.methods.toFleetJSON = function toFleetJSONMethod() {
  return fleetShape(this.toObject());
};

ShipSchema.statics.toFleetPayload = function toFleetPayload(docs) {
  return docs.map((d) =>
    fleetShape(typeof d.toObject === 'function' ? d.toObject() : d)
  );
};

export default mongoose.models.Ship || mongoose.model('Ship', ShipSchema);
