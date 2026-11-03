import type { ActivityRecord, ActivityResult, WorkerRequest } from './types';

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const pending = new Map<number, { resolve: (r: ActivityResult) => void; reject: (e: Error) => void }>();
let nextId = 1;

worker.onmessage = (ev: MessageEvent<{ id: number; result?: ActivityResult; error?: string }>) => {
  const p = pending.get(ev.data.id);
  if (!p) return;
  pending.delete(ev.data.id);
  if (ev.data.error) p.reject(new Error(ev.data.error));
  else p.resolve(ev.data.result!);
};

/** In-memory cache: analysing a 4 h flight takes a few seconds (mostly the XC optimiser) */
const cache = new Map<string, Promise<ActivityResult>>();

export function analyzeRecord(rec: Pick<ActivityRecord, 'files' | 'sport' | 'rules'>): Promise<ActivityResult> {
  const key = JSON.stringify([rec.files.map((f) => [f.name, f.text.length]), rec.sport, rec.rules]);
  let p = cache.get(key);
  if (!p) {
    const id = nextId++;
    p = new Promise<ActivityResult>((resolve, reject) => pending.set(id, { resolve, reject }));
    const req: WorkerRequest = { id, files: rec.files, sport: rec.sport, rules: rec.rules };
    worker.postMessage(req);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}
