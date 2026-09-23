import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProcessReport } from '../core/pipeline';
import type { ProcessOptions } from '../core/types';
import type { ImageFormat } from '../decode/sniff';
import type { ProcessFailure, Quality } from '../worker/protocol';
import { ProcessorClient } from './workerClient';

/** Full-resolution run this long after the last slider movement. */
const SETTLE_MS = 250;
const PREVIEW_MAX_SIDE = 512;

export interface FileInfo {
  name: string;
  bytes: number;
  width: number;
  height: number;
  format: ImageFormat;
  exifOrientation: number;
}

export interface Outcome {
  quality: Quality;
  options: ProcessOptions;
  ms: number;
  processedSize: [number, number];
  report: ProcessReport | null;
  failure: ProcessFailure | null;
  /** 1152x1152 straight RGBA, display only. */
  output: Uint8ClampedArray | null;
}

export interface ProcessorState {
  file: FileInfo | null;
  loading: boolean;
  loadError: string | null;
  /** Latest outcome of any quality (drives the preview image). */
  latest: Outcome | null;
  /** Latest full-resolution outcome (drives the status line). */
  full: Outcome | null;
  busy: boolean;
}

export type ChangeMode = 'drag' | 'commit';

export function useProcessor() {
  const clientRef = useRef<ProcessorClient | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const token = useRef(0);
  const inflight = useRef(0);
  const settleTimer = useRef<number | undefined>(undefined);
  const fileRef = useRef<FileInfo | null>(null);
  const [state, setState] = useState<ProcessorState>({
    file: null, loading: false, loadError: null, latest: null, full: null, busy: false,
  });

  useEffect(() => {
    clientRef.current = new ProcessorClient();
    return () => clientRef.current?.terminate();
  }, []);

  /** Serialize all worker calls; the worker must never see a request before 'loaded'. */
  const enqueue = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    inflight.current++;
    setState((s) => ({ ...s, busy: true }));
    const p = chain.current.then(fn).finally(() => {
      inflight.current--;
      if (inflight.current === 0) setState((s) => ({ ...s, busy: false }));
    });
    chain.current = p.catch(() => undefined);
    return p;
  }, []);

  const requestProcess = useCallback((options: ProcessOptions, quality: Quality) => {
    const my = ++token.current;
    void enqueue(async () => {
      if (my !== token.current || !fileRef.current) return; // superseded by a newer request
      const res = await clientRef.current!.call({ type: 'process', options, quality });
      if (res.type !== 'processed') {
        const message = res.type === 'error' ? res.message : 'Unexpected worker response.';
        setState((s) => ({ ...s, loadError: message }));
        return;
      }
      const outcome: Outcome = {
        quality: res.quality,
        options: res.options,
        ms: res.ms,
        processedSize: res.processedSize,
        report: res.result.ok ? res.result.report : null,
        failure: res.result.ok ? null : res.result.error,
        output: res.result.ok ? new Uint8ClampedArray(res.result.output) : null,
      };
      setState((s) => ({
        ...s,
        latest: outcome.output || quality === 'full' ? outcome : s.latest,
        full: quality === 'full' ? outcome : s.full,
      }));
    });
  }, [enqueue]);

  const load = useCallback(async (file: File, options: ProcessOptions) => {
    window.clearTimeout(settleTimer.current);
    token.current++;
    fileRef.current = null;
    setState((s) => ({ ...s, file: null, loading: true, loadError: null, latest: null, full: null }));
    const bytes = await file.arrayBuffer();
    const res = await enqueue(() => clientRef.current!.call({ type: 'load', bytes }, [bytes]));
    if (res.type !== 'loaded') {
      setState((s) => ({ ...s, loading: false, loadError: res.type === 'error' ? res.message : 'Could not load the file.' }));
      return;
    }
    const info: FileInfo = {
      name: file.name, bytes: file.size, width: res.width, height: res.height,
      format: res.format, exifOrientation: res.exifOrientation,
    };
    fileRef.current = info;
    setState((s) => ({ ...s, file: info, loading: false }));
    requestProcess(options, 'full');
  }, [enqueue, requestProcess]);

  const update = useCallback((options: ProcessOptions, mode: ChangeMode) => {
    const f = fileRef.current;
    if (!f) return;
    window.clearTimeout(settleTimer.current);
    const small = Math.max(f.width, f.height) <= PREVIEW_MAX_SIDE;
    if (mode === 'drag' && !small) {
      requestProcess(options, 'preview');
      settleTimer.current = window.setTimeout(() => requestProcess(options, 'full'), SETTLE_MS);
    } else {
      requestProcess(options, 'full');
    }
  }, [requestProcess]);

  const download = useCallback(async (options: ProcessOptions) => {
    const f = fileRef.current;
    if (!f) return;
    const res = await enqueue(() => clientRef.current!.call({ type: 'encode', options }));
    if (res.type !== 'encoded') {
      setState((s) => ({ ...s, loadError: res.type === 'error' ? res.message : 'Could not create the PNG.' }));
      return;
    }
    const url = URL.createObjectURL(new Blob([res.png], { type: 'image/png' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = outputName(f.name);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, [enqueue]);

  return { state, load, update, download };
}

export function outputName(original: string): string {
  const dot = original.lastIndexOf('.');
  const stem = dot > 0 ? original.slice(0, dot) : original;
  return `${stem}_1152.png`;
}
