import { parentPort, workerData } from 'node:worker_threads';
import { createProject } from '../core/project.js';
try {
  await createProject(workerData.game, workerData.destination, progress => parentPort.postMessage({ progress }));
  parentPort.postMessage({ done: workerData.destination });
} catch (error) { parentPort.postMessage({ error: error.message }); }
