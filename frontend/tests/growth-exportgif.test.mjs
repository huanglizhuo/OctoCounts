import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Same transpile-to-node_modules-cache pattern as github-status.test.mjs, but
// exportGif imports the real GrowthAnimation (which imports ../reportUtils),
// so the cache mirrors the src tree: growth/exportGif.mjs next to
// growth/GrowthAnimation.mjs, and a reportUtils stand-in one level up — the
// real module drags the browser i18n stack into Node, and these tests assert
// on export orchestration, not on formatted strings. Bare specifiers
// ("react", "react/jsx-runtime", "react-dom/server") resolve from
// node_modules exactly as in the sibling growth tests.
const cacheDir = new URL("../node_modules/.cache/octocounts-tests/growth-exportgif/", import.meta.url);
const compile = async (sourceRel, outRel, extraOptions = {}) => {
  const source = await readFile(new URL(`../src/${sourceRel}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, ...extraOptions },
  });
  // The sources use bundler-style extensionless relative imports; Node ESM
  // requires the extension, so append .mjs to every relative specifier.
  const output = compiled.outputText.replace(/(from\s+["'])(\.[^"']+)(["'])/g, "$1$2.mjs$3");
  const target = new URL(outRel, cacheDir);
  await mkdir(new URL(".", target), { recursive: true });
  await writeFile(target, output);
  return target;
};
await compile("growth/exportGif.ts", "growth/exportGif.mjs");
await compile("growth/GrowthAnimation.tsx", "growth/GrowthAnimation.mjs", { jsx: ts.JsxEmit.ReactJSX });
// fixture.ts builds its city layouts through buildScene's exported helpers.
await compile("growth/buildScene.ts", "growth/buildScene.mjs");
await compile("growth/languageLogos.ts", "growth/languageLogos.mjs");
await compile("growth/fixture.ts", "growth/fixture.mjs");
await writeFile(
  new URL("reportUtils.mjs", cacheDir),
  "export const formatNumber = (n) => String(n);\nexport const formatCompactNumber = (n) => String(n);\n",
);

// ---------------------------------------------------------------------------
// The DOM surface exportGif touches — Node has no document, so a minimal
// stub: a body that can hold the hidden host, host divs that record
// attributes/innerHTML, and 2D canvases whose getImageData stamps the
// current rasterization ordinal into the pixels (letting the tests tell
// frames apart and pin the cached seed frame by object identity).
// ---------------------------------------------------------------------------
const domState = { rasterSeq: 0, canvasCalls: [], toBlobCalls: [], captureStreamCalls: [], trackStops: 0 };

class FakeStyle {
  constructor() {
    this.vars = {};
  }
  setProperty(name, value) {
    this.vars[name] = value;
  }
}

class FakeNode {
  constructor(tag) {
    this.tagName = tag;
    this.style = new FakeStyle();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.innerHTML = "";
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null;
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
}

class FakeCanvas extends FakeNode {
  constructor() {
    super("canvas");
    this.width = 0;
    this.height = 0;
  }
  getContext(kind) {
    if (kind !== "2d") return null;
    return {
      clearRect: () => {},
      drawImage: (source, x, y, width, height) => {
        domState.canvasCalls.push({
          width: this.width, height: this.height,
          sourceWidth: source.width, sourceHeight: source.height,
          x, y, drawWidth: width, drawHeight: height,
        });
      },
      getImageData: (x, y, w, h) => {
        const data = new Uint8ClampedArray(w * h * 4);
        data[0] = domState.rasterSeq;
        return { data, width: w, height: h };
      },
    };
  }
  toBlob(callback, type) {
    domState.toBlobCalls.push({ type });
    callback(new Blob([new Uint8Array([0x89, 0x50])], { type }));
  }
  captureStream(frameRate) {
    domState.captureStreamCalls.push({ frameRate, width: this.width, height: this.height });
    return {
      getTracks: () => [{ stop: () => { domState.trackStops += 1; } }],
    };
  }
}

globalThis.document = {
  body: new FakeNode("body"),
  createElement: (tag) => (tag === "canvas" ? new FakeCanvas() : new FakeNode(tag)),
};

const { exportGrowthGif, exportGrowthPng, exportGrowthWebm } = await import(new URL("growth/exportGif.mjs", cacheDir).href);
const { buildFixtureScene } = await import(new URL("growth/fixture.mjs", cacheDir).href);
const { GrowthAnimation } = await import(new URL("growth/GrowthAnimation.mjs", cacheDir).href);
const { createElement } = await import("react");
const { renderToString } = await import("react-dom/server");

test("rooftop LOC follows growth from the start and date pages survive seeking", () => {
  const scene = buildFixtureScene();
  const frame = (progress, value = scene) => renderToString(createElement(GrowthAnimation, { scene: value, progress }));
  const early = frame(0.13);
  const middle = frame(0.5);
  const final = frame(1);
  const loc = (html) => Number(/data-language="JavaScript" data-loc="(\d+)"/.exec(html)[1]);
  assert.ok(early.includes("growth-city-label"));
  assert.ok(loc(early) < loc(middle));
  assert.ok(loc(middle) < loc(final));
  assert.equal(loc(final), scene.samples.at(-1).city.find((block) => block.name === "JavaScript").value);
  assert.equal(frame(0.13), early);
  assert.ok(middle.includes("growth-date-leaf"));
  assert.ok(final.includes(`dateTime="${scene.samples.at(-1).date}"`));
  assert.ok(!final.includes("growth-tl-"));
  assert.ok(final.includes("translate(-238px,"));
  assert.ok(final.includes('class="growth-stars-summary growth-num"'));
  assert.ok(final.includes(`data-stars="${scene.starsNow}"`));
  assert.ok(final.includes('class="growth-finale-id"'));
  assert.ok(final.includes(`data-repo="${scene.repoFullName}"`));
  assert.ok(!final.includes("growth-playback-hit"));
  const interactive = renderToString(createElement(GrowthAnimation, {
    scene, progress: 1, playing: false, interactive: true,
  }));
  assert.ok(!interactive.includes("growth-playback-hit"));
  assert.ok(!interactive.includes("growth-detail"));
  assert.ok(!interactive.includes('class="growth-paused"'));
  const compact = { ...scene, variant: "compact", samples: scene.samples.slice(-1), dips: [] };
  assert.ok(frame(0.5, compact).includes(`dateTime="${compact.samples[0].date}"`));
});

// ---------------------------------------------------------------------------
// Harness: fake deps whose loaders record every call. `failOnFrame` makes
// toCanvas throw when the host holds that frame index (error-path test).
// `supportedTypes` drives the WebM mime negotiation; the fake MediaRecorder
// speaks the real ondataavailable/onstop protocol (stop() emits one data
// chunk, then onstop) so exportGrowthWebm's promise wiring is exercised.
// ---------------------------------------------------------------------------
function makeHarness({ failOnFrame, fontsReady, supportedTypes } = {}) {
  domState.rasterSeq = 0;
  domState.canvasCalls = [];
  domState.captureStreamCalls = [];
  domState.trackStops = 0;
  document.body.children.length = 0;
  document.fonts = fontsReady === undefined ? undefined : { ready: fontsReady };
  const supported = supportedTypes ?? ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  const log = {
    rasterCalls: [], // { frame, progress, options, attached, style, htmlLength, htmlHasStage }
    canvasCalls: domState.canvasCalls,
    quantizeCalls: [], // { data, maxColors }
    applyCalls: [], // { data, palette }
    frames: [], // writeFrame(indexed, width, height, options)
    encoderOptions: null,
    finished: false,
    recorders: [], // fake MediaRecorder instances (WebM path)
  };
  class HarnessMediaRecorder {
    constructor(stream, options) {
      this.stream = stream;
      this.options = options;
      this.state = "inactive";
      this.ondataavailable = null;
      this.onstop = null;
      this.onerror = null;
      this.startCalls = 0;
      this.stopCalls = 0;
      log.recorders.push(this);
    }
    static isTypeSupported(type) {
      return supported.includes(type);
    }
    start() {
      this.startCalls += 1;
      this.state = "recording";
    }
    stop() {
      this.stopCalls += 1;
      if (this.state === "inactive") return;
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob([new Uint8Array([0x1a, 0x45])], { type: "video/webm" }) });
      this.onstop?.();
    }
  }
  const palette = [
    [16, 23, 19],
    [85, 211, 122],
  ];
  const encoder = {
    GIFEncoder(options) {
      log.encoderOptions = options;
      return {
        writeFrame(indexed, width, height, options) {
          log.frames.push({ indexed, width, height, options });
        },
        finish() {
          log.finished = true;
        },
        bytes: () => new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), // "GIF89a"
      };
    },
    quantize(data, maxColors) {
      log.quantizeCalls.push({ data, maxColors });
      return palette;
    },
    applyPalette(data, pal) {
      log.applyCalls.push({ data, palette: pal });
      return new Uint8Array([data[0]]);
    },
  };
  const rasterizer = {
    async toCanvas(host, options) {
      domState.rasterSeq += 1;
      if (failOnFrame !== undefined && host.getAttribute("data-frame") === String(failOnFrame)) {
        throw new Error(`rasterization failed on frame ${failOnFrame}`);
      }
      log.rasterCalls.push({
        frame: Number(host.getAttribute("data-frame")),
        progress: Number(host.getAttribute("data-progress")),
        options,
        attached: host.parentNode === document.body,
        ariaHidden: host.getAttribute("aria-hidden"),
        style: {
          position: host.style.position,
          left: host.style.left,
          width: host.style.width,
          pointerEvents: host.style.pointerEvents,
          scaleVar: host.style.vars["--growth-scale"],
        },
        htmlLength: host.innerHTML.length,
        htmlHasStage: host.innerHTML.includes("growth-stage"),
      });
      const canvas = new FakeCanvas();
      canvas.width = 1280;
      canvas.height = 720;
      return canvas;
    },
  };
  const webmDeps = {
    loadRasterizer: async () => rasterizer,
    MediaRecorder: HarnessMediaRecorder,
    captureStream: (canvas, frameRate) => canvas.captureStream(frameRate),
  };
  return { log, deps: { loadRasterizer: async () => rasterizer, loadEncoder: async () => encoder }, webmDeps, palette };
}

const isAbortError = (error) => error instanceof DOMException && error.name === "AbortError";

test("export: 100 frames, every delay 100ms at native 1280x720, progress 0 -> 1 monotonically", async () => {
  const { log, deps } = makeHarness();
  const seen = [];
  const result = await exportGrowthGif(
    buildFixtureScene(),
    "facebook",
    "react",
    { onProgress: (done, total) => seen.push([done, total]) },
    deps,
  );

  assert.equal(log.frames.length, 100);
  for (const frame of log.frames) {
    assert.equal(frame.options.delay, 100, "frame delay must be 100ms (10fps)");
    assert.equal(frame.width, 1280);
    assert.equal(frame.height, 720);
  }
  assert.equal(log.frames.reduce((duration, frame) => duration + frame.options.delay, 0), 10000);
  assert.equal(log.canvasCalls.length, 100);
  for (const call of log.canvasCalls) {
    assert.deepEqual(call, {
      width: 1280, height: 720,
      sourceWidth: 1280, sourceHeight: 720,
      x: 0, y: 0, drawWidth: 1280, drawHeight: 720,
    });
  }

  // Rasterization order: the palette seed frame (35) first, then every frame
  // in order except the cached seed — 100 toCanvas calls for 100 frames.
  assert.equal(log.rasterCalls.length, 100);
  assert.equal(log.rasterCalls[0].frame, 35);
  assert.ok(Math.abs(log.rasterCalls[0].progress - 35 / 99) < 1e-12);
  const frameProgresses = log.rasterCalls.slice(1).map((call) => call.progress);
  assert.equal(frameProgresses.length, 99);
  assert.equal(frameProgresses[0], 0);
  assert.equal(frameProgresses[frameProgresses.length - 1], 1);
  for (let i = 1; i < frameProgresses.length; i += 1) {
    assert.ok(frameProgresses[i] > frameProgresses[i - 1], `frame ${i} progress went backwards`);
  }

  // The hidden-host contract: parked offscreen, 1280px wide, inert, scale 1.
  const host = log.rasterCalls[0];
  assert.equal(host.ariaHidden, "true");
  assert.deepEqual(host.style, {
    position: "fixed",
    left: "-99999px",
    width: "1280px",
    pointerEvents: "none",
    scaleVar: "1",
  });
  assert.ok(log.rasterCalls.every((call) => call.attached), "host must be live in the document while rasterizing");
  // The clone must be re-parked on-canvas or html-to-image clips to nothing.
  assert.ok(log.rasterCalls.every((call) => {
    assert.deepEqual(call.options, { pixelRatio: 1, style: { position: "static", left: "0", top: "0" } });
    return true;
  }));

  // The real GrowthAnimation ran per frame: markup present, varying with p.
  assert.ok(log.rasterCalls.every((call) => call.htmlHasStage));
  assert.ok(log.rasterCalls[1].htmlLength > 0);
  assert.notEqual(log.rasterCalls[1].htmlLength, log.rasterCalls[log.rasterCalls.length - 1].htmlLength);

  assert.deepEqual(log.encoderOptions, { auto: true });
  assert.equal(log.finished, true);
  assert.equal(result.filename, "octocounts-facebook-react-growth.gif");
  assert.ok(result.blob instanceof Blob);
  assert.equal(result.blob.type, "image/gif");

  // onProgress fires once per encoded frame, 1-based, ending at (total,total).
  assert.equal(seen.length, 100);
  assert.deepEqual(seen[0], [1, 100]);
  assert.deepEqual(seen[seen.length - 1], [100, 100]);
  for (let i = 1; i < seen.length; i += 1) assert.ok(seen[i][0] > seen[i - 1][0]);

  assert.equal(document.body.children.length, 0, "host removed after success");
});

test("png export: the finale frame rasterizes once at 2× into a PNG blob", async () => {
  domState.toBlobCalls = [];
  const { log, deps } = makeHarness();
  const result = await exportGrowthPng(buildFixtureScene(), "facebook", "react", deps);

  // One rasterization, of the finale frame only.
  assert.equal(log.rasterCalls.length, 1);
  assert.equal(log.rasterCalls[0].progress, 1);
  assert.ok(log.rasterCalls[0].htmlHasStage);

  // The hidden host renders at 2560px wide with scale 2 (1280×720 at 2×).
  assert.equal(log.rasterCalls[0].style.width, "2560px");
  assert.equal(log.rasterCalls[0].style.scaleVar, "2");

  // PNG encode requested with the png mime type.
  assert.deepEqual(domState.toBlobCalls, [{ type: "image/png" }]);
  assert.ok(result.blob instanceof Blob);
  assert.equal(result.blob.type, "image/png");
  assert.equal(result.filename, "octocounts-facebook-react-growth.png");

  assert.equal(document.body.children.length, 0, "host removed after success");
});

test("compact scenes export all 100 frames across the complete 10-second timeline", async () => {
  const { log, deps } = makeHarness();
  const seen = [];
  const scene = buildFixtureScene();
  const compactScene = { ...scene, variant: "compact", samples: scene.samples.slice(-1), dips: [] };
  await exportGrowthGif(
    compactScene,
    "facebook",
    "react",
    { onProgress: (done, total) => seen.push([done, total]) },
    deps,
  );

  assert.equal(log.frames.length, 100);
  assert.equal(log.frames.reduce((duration, frame) => duration + frame.options.delay, 0), 10000);
  assert.equal(log.rasterCalls.length, 100);
  assert.equal(log.rasterCalls[0].frame, 35);
  const rest = log.rasterCalls.slice(1);
  assert.equal(rest.length, 99);
  for (let i = 0; i < rest.length; i += 1) {
    assert.equal(rest[i].frame, i < 35 ? i : i + 1, `rasterization ${i + 1} ran on the wrong frame`);
  }
  for (const call of log.rasterCalls) {
    assert.ok(Math.abs(call.progress - call.frame / 99) < 1e-12, `frame ${call.frame} skipped part of the timeline`);
  }
  assert.equal(rest[0].progress, 0);
  assert.equal(rest.at(-1).progress, 1);
  assert.equal(seen.length, 100);
  assert.deepEqual(seen[0], [1, 100]);
  assert.deepEqual(seen.at(-1), [100, 100]);
});

test("font readiness resolves before the seed frame is rasterized", async () => {
  let releaseFonts;
  let markFontWait;
  const fontWaitStarted = new Promise((resolve) => { markFontWait = resolve; });
  const fontsReady = new Promise((resolve) => { releaseFonts = resolve; });
  const { log, deps } = makeHarness({ fontsReady });
  Object.defineProperty(document.fonts, "ready", {
    get() {
      markFontWait();
      return fontsReady;
    },
  });
  const exporting = exportGrowthGif(buildFixtureScene(), "facebook", "react", {}, deps);
  await fontWaitStarted;
  assert.equal(document.body.children.length, 1);
  assert.equal(log.rasterCalls.length, 0);
  assert.equal(log.quantizeCalls.length, 0);
  assert.equal(log.frames.length, 0);
  releaseFonts();
  await exporting;
  assert.equal(log.rasterCalls[0].frame, 35);
  assert.equal(log.frames.length, 100);
  assert.equal(document.body.children.length, 0);
});

test("palette: quantized exactly once from the seed frame and reused for every frame", async () => {
  const { log, deps, palette } = makeHarness();
  await exportGrowthGif(buildFixtureScene(), "facebook", "react", {}, deps);

  assert.equal(log.quantizeCalls.length, 1);
  assert.equal(log.quantizeCalls[0].maxColors, 256);
  assert.equal(log.quantizeCalls[0].data[0], 1, "quantize must feed on the first rasterization (the seed frame)");

  assert.equal(log.applyCalls.length, 100);
  for (const call of log.applyCalls) assert.ok(call.palette === palette, "applyPalette must reuse the fixed palette");
  for (const frame of log.frames) assert.ok(frame.options.palette === palette, "writeFrame must carry the fixed palette");

  // The seed frame's pixels are cached, not re-rasterized: frame 35's
  // applyPalette receives the exact ImageData buffer quantize saw, and the
  // rasterization sequence runs seed(1), frames 0..34 (seq 2..36), frames
  // 36..99 (seq 37..100) — 100 calls, none wasted on frame 35 again.
  assert.equal(log.applyCalls[35].data, log.quantizeCalls[0].data);
  assert.equal(log.rasterCalls.length, 100);
  for (let i = 0; i < 100; i += 1) {
    const expectedSeq = i === 35 ? 1 : i < 35 ? i + 2 : i + 1;
    assert.equal(log.applyCalls[i].data[0], expectedSeq, `frame ${i} encoded the wrong rasterization`);
  }
});

test("aborting around frame 10 rejects with AbortError and removes the host", async () => {
  const controller = new AbortController();
  const { log, deps } = makeHarness();
  const seen = [];
  await assert.rejects(
    exportGrowthGif(
      buildFixtureScene(),
      "facebook",
      "react",
      {
        signal: controller.signal,
        onProgress: (done) => {
          seen.push(done);
          if (done === 10) controller.abort();
        },
      },
      deps,
    ),
    isAbortError,
  );
  assert.equal(log.frames.length, 10, "exactly the first 10 frames were written");
  assert.equal(seen.length, 10);
  assert.equal(log.finished, false, "no GIF is finalized on abort");
  assert.equal(document.body.children.length, 0, "host removed on abort");
});

test("an already-aborted signal rejects before any work", async () => {
  const controller = new AbortController();
  controller.abort();
  const { log, deps } = makeHarness();
  await assert.rejects(
    exportGrowthGif(buildFixtureScene(), "facebook", "react", { signal: controller.signal }, deps),
    isAbortError,
  );
  assert.equal(log.rasterCalls.length, 0);
  assert.equal(log.frames.length, 0);
  assert.equal(document.body.children.length, 0);
});

test("a rasterization failure rejects and still removes the host", async () => {
  const { log, deps } = makeHarness({ failOnFrame: 5 });
  await assert.rejects(
    exportGrowthGif(buildFixtureScene(), "facebook", "react", {}, deps),
    /rasterization failed on frame 5/,
  );
  assert.equal(log.frames.length, 5, "frames 0..4 were encoded before the failure");
  assert.equal(log.finished, false);
  assert.equal(document.body.children.length, 0, "host removed on error");
});

test("filename interpolates owner and repo", async () => {
  const { deps } = makeHarness();
  const result = await exportGrowthGif(buildFixtureScene(), "vercel", "next.js", {}, deps);
  assert.equal(result.filename, "octocounts-vercel-next.js-growth.gif");
});

test("webm export: 100 frames drawn into a 10fps captureStream, recorded start->stop, progress to (100,100)", async () => {
  const { log, webmDeps } = makeHarness();
  const seen = [];
  const result = await exportGrowthWebm(
    buildFixtureScene(),
    "facebook",
    "react",
    { onProgress: (done, total) => seen.push([done, total]) },
    webmDeps,
  );

  // Every frame rasterizes in timeline order (no palette-seed shortcut) and
  // is drawn onto the 1280x720 canvas backing the stream.
  assert.equal(log.rasterCalls.length, 100);
  assert.equal(log.canvasCalls.length, 100);
  for (let i = 0; i < 100; i += 1) {
    assert.equal(log.rasterCalls[i].frame, i);
    assert.ok(Math.abs(log.rasterCalls[i].progress - i / 99) < 1e-12, `frame ${i} skipped part of the timeline`);
    assert.deepEqual(log.canvasCalls[i], {
      width: 1280, height: 720,
      sourceWidth: 1280, sourceHeight: 720,
      x: 0, y: 0, drawWidth: 1280, drawHeight: 720,
    });
  }
  // The hidden-host contract matches the GIF path.
  assert.ok(log.rasterCalls.every((call) => call.attached && call.ariaHidden === "true"));

  // One stream from the shared canvas at 10fps; one recorder started and
  // stopped exactly once, preferring vp9.
  assert.deepEqual(domState.captureStreamCalls, [{ frameRate: 10, width: 1280, height: 720 }]);
  assert.equal(log.recorders.length, 1);
  const recorder = log.recorders[0];
  assert.equal(recorder.options.mimeType, "video/webm;codecs=vp9");
  assert.equal(recorder.startCalls, 1);
  assert.equal(recorder.stopCalls, 1);
  assert.equal(recorder.state, "inactive");

  // onProgress fires once per drawn frame, 1-based, ending at (total,total).
  assert.equal(seen.length, 100);
  assert.deepEqual(seen[0], [1, 100]);
  assert.deepEqual(seen[seen.length - 1], [100, 100]);

  assert.ok(result.blob instanceof Blob);
  assert.equal(result.blob.type, "video/webm");
  assert.equal(result.filename, "octocounts-facebook-react-growth.webm");
  assert.equal(document.body.children.length, 0, "host removed after success");
});

test("webm export: falls back along the mime chain and rejects with a clear error when nothing is supported", async () => {
  // vp9 unsupported -> vp8 is chosen.
  const { log, webmDeps } = makeHarness({ supportedTypes: ["video/webm;codecs=vp8", "video/webm"] });
  const result = await exportGrowthWebm(buildFixtureScene(), "facebook", "react", {}, webmDeps);
  assert.equal(log.recorders.length, 1);
  assert.equal(log.recorders[0].options.mimeType, "video/webm;codecs=vp8");
  assert.equal(result.blob.type, "video/webm");
  assert.equal(document.body.children.length, 0);

  // Nothing supported -> explicit rejection before any recorder or raster.
  const { log: logNone, webmDeps: webmDepsNone } = makeHarness({ supportedTypes: [] });
  await assert.rejects(
    exportGrowthWebm(buildFixtureScene(), "facebook", "react", {}, webmDepsNone),
    /no supported video\/webm mime type/,
  );
  assert.equal(logNone.recorders.length, 0);
  assert.equal(logNone.rasterCalls.length, 0);
  assert.equal(document.body.children.length, 0, "host removed when no mime is supported");
});

test("webm export: aborting around frame 10 rejects with AbortError, stops the recorder and removes the host", async () => {
  const controller = new AbortController();
  const { log, webmDeps } = makeHarness();
  const seen = [];
  await assert.rejects(
    exportGrowthWebm(
      buildFixtureScene(),
      "facebook",
      "react",
      {
        signal: controller.signal,
        onProgress: (done) => {
          seen.push(done);
          if (done === 10) controller.abort();
        },
      },
      webmDeps,
    ),
    isAbortError,
  );
  assert.equal(seen.length, 10, "progress fired for exactly the first 10 frames");
  const recorder = log.recorders[0];
  assert.equal(recorder.startCalls, 1);
  assert.equal(recorder.stopCalls, 1, "recorder is stopped exactly once on abort");
  assert.equal(recorder.state, "inactive");
  assert.ok(domState.trackStops >= 1, "stream tracks are stopped on abort");
  assert.equal(document.body.children.length, 0, "host removed on abort");
});
