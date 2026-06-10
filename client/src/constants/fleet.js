export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5050';
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5050';

export const MAP_CENTER = [26.0, 55.0];
export const MAP_ZOOM = 7;
export const TICK_MS = 1000;

export const PORTS = [
  { id: 'KWT-1', name: 'Kuwait City', position: [29.48, 48.34] },
  { id: 'BUS-1', name: 'Bushehr', position: [28.83, 50.73] },
  { id: 'DMM-1', name: 'Dammam', position: [26.56, 50.3] },
  { id: 'BAH-1', name: 'Manama', position: [26.5, 50.55] },
  { id: 'DOH-1', name: 'Doha', position: [25.46, 51.95] },
  { id: 'AUH-1', name: 'Abu Dhabi', position: [25.22, 54.18] },
  { id: 'DXB-1', name: 'Jebel Ali', position: [25.5, 54.75] },
  { id: 'BND-1', name: 'Bandar Abbas', position: [26.62, 56.11] },
  { id: 'SOH-1', name: 'Sohar', position: [24.72, 57.02] },
  { id: 'MCT-1', name: 'Muscat', position: [23.92, 58.58] },
];
