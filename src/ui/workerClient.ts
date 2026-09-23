import type { WorkerRequest, WorkerResponse } from '../worker/protocol';

type Pending = { resolve: (r: WorkerResponse) => void };

/** Request/response wrapper around the processing worker. */
export class ProcessorClient {
  private worker = new Worker(new URL('../worker/processor.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(ev.data.id);
      if (p) {
        this.pending.delete(ev.data.id);
        p.resolve(ev.data);
      }
    };
  }

  // Distributes Omit over the union members.
  call(msg: WorkerRequest extends infer R ? (R extends WorkerRequest ? Omit<R, 'id'> : never) : never, transfer: Transferable[] = []): Promise<WorkerResponse> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, { resolve });
      this.worker.postMessage({ ...msg, id } as WorkerRequest, transfer);
    });
  }

  terminate(): void {
    this.worker.terminate();
  }
}
