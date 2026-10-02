// GIF export renders the full growth timeline at the native 1280x720
// design resolution: 100 frames at 10fps, including low-sample scenes.
// renderToString runs no effects, so the exporter sets --growth-scale to 1
// on the hidden host and waits for document fonts before rasterizing.
// html-to-image embeds @font-face rules and copies resolved styles from
// the live subtree. Frame progress is deterministic.
//
// Quantize once from frame 35 and reuse that palette for every frame to
// prevent color-table flicker. Keep the seed pixels for that frame's encode.
import { createElement } from "react";
import type { ReactElement } from "react";
import { GrowthAnimation } from "./GrowthAnimation";
import type { GrowthScene } from "./types";

export type GrowthGifOptions = {
  /** Called after each encoded frame with (framesDone, framesTotal). */
  onProgress?: (done: number, total: number) => void;
  /** Aborting between frames rejects with a DOMException "AbortError" after cleaning up the export host. */
  signal?: AbortSignal;
};

// html-to-image / gifenc loaders are injected so the orchestration tests can
// drive the whole export with recording fakes; the defaults are the real
// dynamic imports, so both libraries stay out of every bundle until an
// export actually starts.
type RasterizerModule = {
  toCanvas(
    node: HTMLElement,
    options?: { pixelRatio?: number; style?: Partial<CSSStyleDeclaration> },
  ): Promise<HTMLCanvasElement>;
};
type EncoderModule = typeof import("gifenc");

export type GrowthGifDeps = {
  loadRasterizer: () => Promise<RasterizerModule>;
  loadEncoder: () => Promise<EncoderModule>;
};

const defaultDeps: GrowthGifDeps = {
  loadRasterizer: () => import("html-to-image"),
  loadEncoder: () => import("gifenc"),
};

export type GrowthWebmOptions = {
  /** Called after each drawn frame with (framesDone, framesTotal). */
  onProgress?: (done: number, total: number) => void;
  /** Aborting between frames stops the recorder and rejects with a DOMException "AbortError" after cleaning up the export host. */
  signal?: AbortSignal;
};

// MediaRecorder and captureStream are injected (like the rasterizer/encoder
// loaders) so the orchestration tests can drive the export with recording
// fakes; the defaults are the real browser APIs.
export type GrowthWebmDeps = {
  loadRasterizer: () => Promise<RasterizerModule>;
  MediaRecorder: typeof MediaRecorder;
  captureStream: (canvas: HTMLCanvasElement, frameRate: number) => MediaStream;
};

const defaultWebmDeps: GrowthWebmDeps = {
  loadRasterizer: () => import("html-to-image"),
  MediaRecorder: globalThis.MediaRecorder,
  captureStream: (canvas, frameRate) => canvas.captureStream(frameRate),
};

const EXPORT_WIDTH = 1280;
const EXPORT_HEIGHT = 720;
// The PNG card renders the finale frame at 2×: it is a single raster, so the
// extra resolution is free and keeps the share card crisp on retina/social.
const PNG_WIDTH = 2560;
const PNG_HEIGHT = 1440;
const PNG_PROGRESS = 1;
const FRAME_DELAY_MS = 100;
const TOTAL_FRAMES = 100;
// captureStream frame rate for the WebM export: 10fps matches FRAME_DELAY_MS
// so each drawn frame is recorded exactly once.
const EXPORT_FPS = 10;
const PALETTE_SEED_FRAME = 35;
const MAX_COLORS = 256;

function frameProgresses(): number[] {
  return Array.from({ length: TOTAL_FRAMES }, (_, i) => i / (TOTAL_FRAMES - 1));
}

// data-frame/data-progress expose the hidden host's current frame to the
// rasterizer harness and browser diagnostics.
function createExportHost(width: number, scale: number): HTMLDivElement {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.position = "fixed";
  host.style.top = "0";
  host.style.left = "-99999px";
  host.style.width = `${width}px`;
  host.style.pointerEvents = "none";
  host.style.setProperty("--growth-scale", String(scale));
  return host;
}

// Render one frame into the live host and rasterize it. html-to-image clones
// the host, so the style override parks the clone back on-canvas or every
// capture comes out clipped to a blank canvas.
async function rasterizeFrame(
  host: HTMLDivElement,
  rasterizer: RasterizerModule,
  scene: GrowthScene,
  renderToString: (element: ReactElement) => string,
  progress: number,
): Promise<HTMLCanvasElement> {
  host.setAttribute("data-progress", String(progress));
  host.innerHTML = renderToString(createElement(GrowthAnimation, { scene, progress }));
  return rasterizer.toCanvas(host, {
    pixelRatio: 1,
    style: { position: "static", left: "0", top: "0" },
  });
}

export async function exportGrowthGif(
  scene: GrowthScene,
  owner: string,
  repo: string,
  options: GrowthGifOptions = {},
  deps: GrowthGifDeps = defaultDeps,
): Promise<{ blob: Blob; filename: string }> {
  const progresses = frameProgresses();
  const total = progresses.length;
  const signal = options.signal;
  const host = createExportHost(EXPORT_WIDTH, 1);
  document.body.appendChild(host);
  try {
    const abortError = () => new DOMException("Aborted", "AbortError");
    if (signal?.aborted) throw abortError();
    const [rasterizer, gifenc, { renderToString }] = await Promise.all([
      deps.loadRasterizer(),
      deps.loadEncoder(),
      import("react-dom/server"),
    ]);
    await document.fonts?.ready;
    if (signal?.aborted) throw abortError();
    const shared = document.createElement("canvas");
    shared.width = EXPORT_WIDTH;
    shared.height = EXPORT_HEIGHT;
    const ctx = shared.getContext("2d");
    if (!ctx) throw new Error("growth GIF export: no 2D canvas context");
    const gif = gifenc.GIFEncoder({ auto: true });

    // Render into the live host and copy onto the native 1280x720 canvas
    // at pixelRatio 1. drawImage handles any rasterizer rounding.
    const rasterize = async (frameIndex: number): Promise<ImageData> => {
      host.setAttribute("data-frame", String(frameIndex));
      const rasterized = await rasterizeFrame(host, rasterizer, scene, renderToString, progresses[frameIndex]);
      ctx.clearRect(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
      ctx.drawImage(rasterized, 0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
      return ctx.getImageData(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
    };

    // Fixed palette: rasterize the seed frame up front, quantize its pixels
    // once, and keep the ImageData so the main loop does not rasterize the
    // seed frame a second time.
    const seedIndex = Math.min(PALETTE_SEED_FRAME, total - 1);
    const seedFrame = await rasterize(seedIndex);
    const palette = gifenc.quantize(seedFrame.data, MAX_COLORS);

    for (let i = 0; i < total; i += 1) {
      if (signal?.aborted) throw abortError();
      const frame = i === seedIndex ? seedFrame : await rasterize(i);
      const indexed = gifenc.applyPalette(frame.data, palette);
      gif.writeFrame(indexed, EXPORT_WIDTH, EXPORT_HEIGHT, { palette, delay: FRAME_DELAY_MS });
      options.onProgress?.(i + 1, total);
      // Hand the thread back between frames so the caller's progress bar
      // paints and a cancel click stays responsive across the long loop.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    gif.finish();
    const blob = new Blob([new Uint8Array(gif.bytes())], { type: "image/gif" });
    return { blob, filename: `octocounts-${owner}-${repo}-growth.gif` };
  } finally {
    host.parentNode?.removeChild(host);
  }
}

// PNG export is the finale frame at 2× — the settled city with its identity
// banner, stars, date and metric bar doubles as the share card. Single
// raster, so unlike the GIF there is no frame loop and no palette.
export async function exportGrowthPng(
  scene: GrowthScene,
  owner: string,
  repo: string,
  deps: Pick<GrowthGifDeps, "loadRasterizer"> = defaultDeps,
): Promise<{ blob: Blob; filename: string }> {
  const host = createExportHost(PNG_WIDTH, 2);
  document.body.appendChild(host);
  try {
    const [rasterizer, { renderToString }] = await Promise.all([deps.loadRasterizer(), import("react-dom/server")]);
    await document.fonts?.ready;
    const canvas = await rasterizeFrame(host, rasterizer, scene, renderToString, PNG_PROGRESS);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("growth PNG export: toBlob returned null"))), "image/png");
    });
    return { blob, filename: `octocounts-${owner}-${repo}-growth.png` };
  } finally {
    host.parentNode?.removeChild(host);
  }
}

// WebM export reuses the GIF pipeline's hidden host and rasterizer, but
// instead of quantizing frames it draws each of the same 100 deterministic
// frames onto a live 1280x720 canvas and records that canvas's 10fps stream
// with a MediaRecorder. Every frame is left on screen for FRAME_DELAY_MS so
// the 10-second timeline is captured in real time — the sleeps exist for
// correctness of the capture, not to yield the main thread.
const WEBM_MIME_CANDIDATES = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

export async function exportGrowthWebm(
  scene: GrowthScene,
  owner: string,
  repo: string,
  options: GrowthWebmOptions = {},
  deps: GrowthWebmDeps = defaultWebmDeps,
): Promise<{ blob: Blob; filename: string }> {
  const progresses = frameProgresses();
  const total = progresses.length;
  const signal = options.signal;
  const host = createExportHost(EXPORT_WIDTH, 1);
  document.body.appendChild(host);
  try {
    const abortError = () => new DOMException("Aborted", "AbortError");
    if (signal?.aborted) throw abortError();
    if (typeof deps.MediaRecorder === "undefined" || typeof deps.MediaRecorder.isTypeSupported !== "function") {
      throw new Error("growth WebM export: MediaRecorder is not available in this browser");
    }
    const mime = WEBM_MIME_CANDIDATES.find((candidate) => deps.MediaRecorder.isTypeSupported(candidate));
    if (!mime) {
      throw new Error("growth WebM export: no supported video/webm mime type (vp9/vp8/plain) from MediaRecorder");
    }
    const [rasterizer, { renderToString }] = await Promise.all([deps.loadRasterizer(), import("react-dom/server")]);
    await document.fonts?.ready;
    if (signal?.aborted) throw abortError();
    const shared = document.createElement("canvas");
    shared.width = EXPORT_WIDTH;
    shared.height = EXPORT_HEIGHT;
    const ctx = shared.getContext("2d");
    if (!ctx) throw new Error("growth WebM export: no 2D canvas context");
    const stream = deps.captureStream(shared, EXPORT_FPS);
    const recorder = new deps.MediaRecorder(stream, { mimeType: mime });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data) chunks.push(event.data);
    };
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error("growth WebM export: MediaRecorder failed while recording"));
    });
    recorder.start();
    try {
      for (let i = 0; i < total; i += 1) {
        if (signal?.aborted) throw abortError();
        host.setAttribute("data-frame", String(i));
        const rasterized = await rasterizeFrame(host, rasterizer, scene, renderToString, progresses[i]);
        ctx.clearRect(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
        ctx.drawImage(rasterized, 0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
        options.onProgress?.(i + 1, total);
        // The 10fps stream only captures a frame while it stays on the canvas
        // for ~100ms, so hold each one for a tick the way the GIF loop does.
        await new Promise<void>((resolve) => setTimeout(resolve, FRAME_DELAY_MS));
      }
    } finally {
      if (recorder.state !== "inactive") recorder.stop();
      for (const track of stream.getTracks()) track.stop();
    }
    await stopped;
    if (signal?.aborted) throw abortError();
    const blob = new Blob(chunks, { type: "video/webm" });
    return { blob, filename: `octocounts-${owner}-${repo}-growth.webm` };
  } finally {
    host.parentNode?.removeChild(host);
  }
}
