import type { BelegfuchsApi } from '../../preload/index';

declare global {
  interface Window {
    belegfuchs: BelegfuchsApi;
  }
}

export {};
