// GIF export for the growth animation (GROWTH-ANIMATION-PLAN.md §5).
//
// The renderer is a pure function of (scene, progress), so exporting is just
// stepping it: render each frame into a hidden 640x360 host, rasterize the
// host with html-to-image, and stream the frames through gifenc at 10fps.
// Nothing here reads a clock or a random source — frame N of an export is
// pixel-identical to what the on-page player shows at that progress.
//
// Render path decision: react-dom/server's renderToString per frame into the
// live host's innerHTML (dynamically imported, so react-dom/server stays out
// of the growth chunk until an export actually starts). The component is
// pure and its only effect is the ResizeObserver that scales the 1280x720
// design stage into its wrapper — the exporter owns the host width and sets
// --growth-scale itself (renderToString runs no effects), which covers
// exactly what that observer would have computed (640/1280 = 0.5). Fonts:
// html-to-image embeds @font-face rules by parsing the document stylesheets
// and inlining the woff2 files, and it copies RESOLVED computed styles from
// the live subtree — both are independent of who created the DOM under the
// host (the earlier history-chart GIF export relied on exactly this,
// document-font text included). Real-browser verification of the embedded
// font is Wave-3 QA; should it fail there, the swap is local to `rasterize`
// below (a createRoot + flushSync live root renders the same component).
//
// Palette: quantizing per frame lets two near-identical frames pick
// slightly different color tables, which plays back as flicker — the
// original history-chart GIF palette documented the same determinism
// requirement. The growth scene's inventory is too rich for a hand-written
// table (language colors from the scene, the amber dip accent, the GitHub
// gray #57606a, anti-aliased text over theme backgrounds), so the palette
// is quantized ONCE from a mid-data-act seed frame — frame 35, which
// already shows the race colors, the dip beat, and the terminal text — and
// that single table maps every frame. If the seed frame carries more than
// 256 distinct colors, quantize collapses them there, once, deterministically.
import { createElement } from "react";
import { GrowthAnimation } from "./GrowthAnimation";
import type { GrowthScene } from "./types";

export type GrowthGifOptions = {
  /** Frame plan: "full" = the whole 10s template (100 frames); "compact" = 60 frames skipping the hook act. Defaults to the scene's own variant. */
  variant?: "full" | "compact";
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

// 640x360 (the 1280x720 design canvas at exactly 1/2) at 10fps. The 10s
// template gives full = 100 frames at progress i/99; compact re-times 60
// frames linearly across scene seconds 1.2 -> 10, skipping the terminal
// hook act: progress = (1.2 + (i / 59) * 8.8) / 10.
const EXPORT_WIDTH = 640;
const EXPORT_HEIGHT = 360;
const FRAME_DELAY_MS = 100;
const FULL_FRAMES = 100;
const COMPACT_FRAMES = 60;
const COMPACT_START_SEC = 1.2;
const COMPACT_SPAN_SEC = 8.8;
const TEMPLATE_SEC = 10;
const PALETTE_SEED_FRAME = 35;
const MAX_COLORS = 256;

function frameProgresses(variant: "full" | "compact"): number[] {
  if (variant === "compact") {
    return Array.from(
      { length: COMPACT_FRAMES },
      (_, i) => (COMPACT_START_SEC + (i / (COMPACT_FRAMES - 1)) * COMPACT_SPAN_SEC) / TEMPLATE_SEC,
    );
  }
  return Array.from({ length: FULL_FRAMES }, (_, i) => i / (FULL_FRAMES - 1));
}

// The hidden export host: parked offscreen, never interactive, exactly one
// 640px-wide wrapper — the component inside renders 640x360 by its own
// aspect-ratio + scale rules. data-frame/data-progress mark which frame the
// host currently holds (inspectable when a real-browser export misbehaves;
// the tests read them back through the rasterizer fake).
function createExportHost(): HTMLDivElement {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.position = "fixed";
  host.style.top = "0";
  host.style.left = "-99999px";
  host.style.width = `${EXPORT_WIDTH}px`;
  host.style.pointerEvents = "none";
  // At 640px wide the 1280x720 design stage scales by exactly 0.5. The
  // component would set this var from an effect; renderToString never runs
  // effects, so the export sets it here. Custom properties inherit, so it
  // reaches .growth-stage through .growth-wrap.
  host.style.setProperty("--growth-scale", "0.5");
  return host;
}

export async function exportGrowthGif(
  scene: GrowthScene,
  owner: string,
  repo: string,
  options: GrowthGifOptions = {},
  deps: GrowthGifDeps = defaultDeps,
): Promise<{ blob: Blob; filename: string }> {
  const progresses = frameProgresses(options.variant ?? scene.variant);
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
    const shared = document.createElement("canvas");
    shared.width = EXPORT_WIDTH;
    shared.height = EXPORT_HEIGHT;
    const ctx = shared.getContext("2d");
    if (!ctx) throw new Error("growth GIF export: no 2D canvas context");
    const gif = gifenc.GIFEncoder({ auto: true });

    // One frame: render at `progress` into the live host, rasterize the
    // host, and normalize onto the shared 640x360 canvas (pixelRatio 1;
    // drawImage rescales any rounding html-to-image measured on its own).
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
