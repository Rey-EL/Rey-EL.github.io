/**
 * main.js — boot. Loaded as a module from index.html (no inline script; the CSP forbids
 * it). Creates the app, restores preferences, offers resume, registers the worker, and
 * asks the proxy (no user data) whether it is serving synthetic review fixtures.
 */
import { createApp, registerServiceWorker } from './app.js';

const root = document.getElementById('app');
const ctx = createApp(root);
ctx.render();
registerServiceWorker(ctx);

// Health probe: carries no address, hash, or answer. Used only for the review banner.
fetch('api/v1/health', { cache: 'no-store', credentials: 'omit' })
  .then((r) => r.json())
  .then((b) => { if (b && b.mode === 'fixtures') { ctx.fixtureMode = true; ctx.render(); } })
  .catch(() => { /* offline or no proxy: Check 5 explains when it is used */ });
