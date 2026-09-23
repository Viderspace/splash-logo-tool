import type { ProcessReport } from '../core/pipeline';
import type { ProcessOptions } from '../core/types';
import type { ImageFormat } from '../decode/sniff';

export type Quality = 'preview' | 'full';

export type WorkerRequest =
  | { type: 'load'; id: number; bytes: ArrayBuffer }
  | { type: 'process'; id: number; options: ProcessOptions; quality: Quality }
  | { type: 'encode'; id: number; options: ProcessOptions };

export interface ProcessFailure {
  kind: 'borderMatch' | 'sideMismatch' | 'empty' | 'internal';
  message: string;
}

export type WorkerResponse =
  | { type: 'loaded'; id: number; width: number; height: number; format: ImageFormat; exifOrientation: number; ms: number }
  | {
      type: 'processed';
      id: number;
      quality: Quality;
      options: ProcessOptions;
      ms: number;
      /** Source size actually processed (smaller than the file for previews of large images). */
      processedSize: [number, number];
      result: { ok: true; report: ProcessReport; output: ArrayBuffer } | { ok: false; error: ProcessFailure };
    }
  | { type: 'encoded'; id: number; png: ArrayBuffer; ms: number }
  | { type: 'error'; id: number; message: string };
