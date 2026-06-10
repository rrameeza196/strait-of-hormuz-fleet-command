import React from 'react';
import ReactDOM from 'react-dom/client';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/hud.css';
import './styles/sidebar.css';
import './styles/map-markers.css';
import './styles/map-threats.css';
import App from './App.jsx';

window.L = L;

async function bootstrap() {
  await import('@geoman-io/leaflet-geoman-free');
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap app:', error);
});
