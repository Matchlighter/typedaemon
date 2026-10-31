import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Output goes to <repo>/dist/dashboard, which the HTTP plugin serves at `/`.
// `base: './'` keeps every asset URL relative so it works under HA Ingress.
export default defineConfig({
    base: './',
    plugins: [react()],
    resolve: {
        alias: { '@protocol': path.resolve(__dirname, '../src/dashboard/protocol.ts') },
    },
    build: {
        outDir: path.resolve(__dirname, '../dist/dashboard'),
        emptyOutDir: true,
    },
    // Dev: `yarn --cwd dashboard dev` proxies the admin ws to a local daemon on :8099
    server: { proxy: { '/ws': { target: 'ws://localhost:8099', ws: true } } },
    test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
});
