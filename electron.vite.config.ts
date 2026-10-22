import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    build: {
      // Laufzeit-Abhängigkeiten (node-llama-cpp, tesseract.js, exceljs, fflate) bleiben in node_modules
      externalizeDeps: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'ocr-worker': resolve(__dirname, 'src/main/ocr-worker.ts')
        }
      }
    }
  },
  preload: {
    build: {
      externalizeDeps: true
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    }
  }
});
