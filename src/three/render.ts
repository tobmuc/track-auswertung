import * as THREE from 'three';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { Plan } from './director';
import { drawHud, type HudOptions } from './hud';
import type { Model } from './model';
import type { FlightScene } from './scene';

/** Renders frames of a plan: WebGL scene into an offscreen canvas, then HUD on top in a 2D canvas */
export class FrameRenderer {
  readonly gl: THREE.WebGLRenderer;
  readonly out: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(private scene: FlightScene, private m: Model, public plan: Plan, public hud: HudOptions, out?: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, logarithmicDepthBuffer: true });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.out = out ?? document.createElement('canvas');
    this.ctx = this.out.getContext('2d')!;
  }

  setSize(w: number, h: number) {
    if (this.out.width !== w || this.out.height !== h) {
      this.out.width = w;
      this.out.height = h;
    }
    const size = this.gl.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) this.gl.setSize(w, h, false);
  }

  render(frameNo: number) {
    const w = this.out.width;
    const h = this.out.height;
    const n = Math.min(this.plan.frames.length - 1, Math.max(0, Math.round(frameNo)));
    this.scene.update(this.plan.frames[n], w, h, { frameNo: n, plan: this.plan });
    this.gl.render(this.scene.scene, this.scene.camera);
    this.ctx.drawImage(this.gl.domElement, 0, 0, w, h);
    drawHud(this.ctx, w, h, this.m, this.plan, n, this.hud);
  }

  dispose() {
    this.gl.dispose();
  }
}

/** AAC if the browser can encode it, else Opus (both are valid in MP4); null = export without sound */
async function pickAudioCodec(a: AudioBuffer): Promise<{ codec: string; mux: 'aac' | 'opus' } | null> {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const [codec, mux] of [['mp4a.40.2', 'aac'], ['opus', 'opus']] as const) {
    const s = await AudioEncoder.isConfigSupported({ codec, sampleRate: a.sampleRate, numberOfChannels: a.numberOfChannels, bitrate: 160_000 });
    if (s.supported) return { codec, mux };
  }
  return null;
}

/** Encodes the whole soundtrack in 100 ms chunks */
async function encodeAudio(a: AudioBuffer, codec: string, muxer: Muxer<ArrayBufferTarget>) {
  let failure: Error | null = null;
  const enc = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => (failure = e as Error),
  });
  enc.configure({ codec, sampleRate: a.sampleRate, numberOfChannels: a.numberOfChannels, bitrate: 160_000 });
  const ch = a.numberOfChannels;
  const step = Math.round(a.sampleRate / 10);
  for (let off = 0; off < a.length; off += step) {
    const n = Math.min(step, a.length - off);
    const planar = new Float32Array(n * ch);
    for (let c = 0; c < ch; c++) planar.set(a.getChannelData(c).subarray(off, off + n), c * n);
    const data = new AudioData({ format: 'f32-planar', sampleRate: a.sampleRate, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round((off / a.sampleRate) * 1e6), data: planar });
    enc.encode(data);
    data.close();
  }
  await enc.flush();
  enc.close();
  if (failure) throw failure;
}

export function canEncodeVideo(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/** H.264 MP4 via WebCodecs; renders every frame deterministically (not real time) */
export async function exportMp4(
  r: FrameRenderer,
  width: number,
  height: number,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
  audio?: AudioBuffer | null,
): Promise<Blob> {
  const fps = r.plan.fps;
  const total = r.plan.frames.length;
  const candidates = ['avc1.640033', 'avc1.4d0033', 'avc1.42003e'];
  let codec = '';
  for (const c of candidates) {
    const s = await VideoEncoder.isConfigSupported({ codec: c, width, height, bitrate: 12e6, framerate: fps });
    if (s.supported) { codec = c; break; }
  }
  if (!codec) throw new Error(`Dein Browser kann kein H.264 in ${width}×${height} kodieren.`);

  const audioCodec = audio ? await pickAudioCodec(audio) : null;
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height, frameRate: fps },
    ...(audio && audioCodec ? { audio: { codec: audioCodec.mux, numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate } } : {}),
    fastStart: 'in-memory',
  });
  let failure: Error | null = null;
  if (audio && audioCodec) await encodeAudio(audio, audioCodec.codec, muxer);
  const enc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (failure = e as Error),
  });
  enc.configure({ codec, width, height, bitrate: width * height >= 1920 * 1080 ? 12e6 : 6e6, framerate: fps });

  r.setSize(width, height);
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) { enc.close(); throw new DOMException('Abgebrochen', 'AbortError'); }
    if (failure) throw failure;
    r.render(i);
    const frame = new VideoFrame(r.out, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
    enc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    if (enc.encodeQueueSize > 6) await new Promise((res) => enc.addEventListener('dequeue', res, { once: true }));
    if (i % 10 === 0) {
      onProgress(i + 1, total);
      // setTimeout, not rAF: keeps rendering when the tab is in the background
      await new Promise((res) => setTimeout(res, 0));
    }
  }
  await enc.flush();
  enc.close();
  if (failure) throw failure;
  muxer.finalize();
  onProgress(total, total);
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}
