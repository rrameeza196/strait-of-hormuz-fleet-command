import mongoose from 'mongoose';

const PortSchema = new mongoose.Schema(
  {
    portId: { type: String, required: true, unique: true, index: true },
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
  },
  { timestamps: true }
);

PortSchema.index({ location: '2dsphere' });

export default mongoose.models.Port || mongoose.model('Port', PortSchema);
