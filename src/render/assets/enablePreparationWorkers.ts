import { PreparationWorker } from './PreparationWorker';
// Kept out of worker-importable asset modules so a worker never bundles another copy of itself.
PreparationWorker.factory = () => new Worker(new URL('./preparation.worker.ts', import.meta.url), { type: 'module' });
