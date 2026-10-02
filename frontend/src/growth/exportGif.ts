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

const EXPORT_WIDTH = 1280;
const EXPORT_HEIGHT = 720;
const FRAME_DELAY_MS = 100;
const TOTAL_FRAMES = 100;
const PALETTE_SEED_FRAME = 35;
const MAX_COLORS = 256;

function frameProgresses(): number[] {
  return Array.from({ length: TOTAL_FRAMES }, (_, i) => i / (TOTAL_FRAMES - 1));
}

// data-frame/data-progress expose the hidden host's current frame to the
// rasterizer harness and browser diagnostics.
function createExportHost(): HTMLDivElement {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.position = "fixed";
  host.style.top = "0";
  host.style.left = "-99999px";
  host.style.width = `${EXPORT_WIDTH}px`;
  host.style.pointerEvents = "none";
  host.style.setProperty("--growth-scale", "1");
  return host;
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
  const host = createExportHost();
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
      host.setAttribute("data-progress", String(progresses[frameIndex]));
      host.innerHTML = renderToString(createElement(GrowthAnimation, { scene, progress: progresses[frameIndex] }));
      const rasterized = await rasterizer.toCanvas(host, {
        pixelRatio: 1,
        // The host is parked offscreen in the live document; html-to-image
        // clones it, so park the clone back on-canvas before rasterizing or
        // every frame comes out clipped to a blank canvas.
        style: { position: "static", left: "0", top: "0" },
      });
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
