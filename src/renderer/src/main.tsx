import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useStore } from './store';
import './styles.css';

// Zugriff für Fehlersuche (DevTools mit F12) und automatisierte Tests
(window as unknown as { __belegfuchs: unknown }).__belegfuchs = { useStore };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
