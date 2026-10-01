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
const domState = { rasterSeq: 0 };

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
      drawImage: () => {},
      getImageData: (x, y, w, h) => {
        const data = new Uint8ClampedArray(w * h * 4);
        data[0] = domState.rasterSeq;
        return { data, width: w, height: h };
      },
    };
  }
}

globalThis.document = {
  body: new FakeNode("body"),
  createElement: (tag) => (tag === "canvas" ? new FakeCanvas() : new FakeNode(tag)),
};

const { exportGrowthGif } = await import(new URL("growth/exportGif.mjs", cacheDir).href);
const { buildFixtureScene } = await import(new URL("growth/fixture.mjs", cacheDir).href);

// ---------------------------------------------------------------------------
// Harness: fake deps whose loaders record every call. `failOnFrame` makes
// toCanvas throw when the host holds that frame index (error-path test).
// ---------------------------------------------------------------------------
function makeHarness({ failOnFrame } = {}) {
  domState.rasterSeq = 0;
  document.body.children.length = 0;
  const log = {
    rasterCalls: [], // { frame, progress, options, attached, host, htmlLength, htmlHasStage }
    quantizeCalls: [], // { data, maxColors }
    applyCalls: [], // { data, palette }
    frames: [], // writeFrame(indexed, width, height, options)
    progress: [], // [done, total]
    encoderOptions: null,
    finished: false,
  };
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
      canvas.width = 640;
      canvas.height = 360;
      return canvas;
    },
  };
  return { log, deps: { loadRasterizer: async () => rasterizer, loadEncoder: async () => encoder }, palette };
}

const isAbortError = (error) => error instanceof DOMException && error.name === "AbortError";

test("full export: 100 frames, every delay 100ms at 640x360, progress 0 -> 1 monotonically", async () => {
  const { log, deps } = makeHarness();
  const seen = [];
  const result = await exportGrowthGif(
    buildFixtureScene(),
    "facebook",
    "react",
    { variant: "full", onProgress: (done, total) => seen.push([done, total]) },
    deps,
  );

  assert.equal(log.frames.length, 100);
  for (const frame of log.frames) {
    assert.equal(frame.options.delay, 100, "frame delay must be 100ms (10fps)");
    assert.equal(frame.width, 640);
    assert.equal(frame.height, 360);
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

  // The hidden-host contract: parked offscreen, 640px wide, inert, scale 0.5.
  const host = log.rasterCalls[0];
  assert.equal(host.ariaHidden, "true");
  assert.deepEqual(host.style, {
    position: "fixed",
    left: "-99999px",
    width: "640px",
    pointerEvents: "none",
    scaleVar: "0.5",
  });
  assert.ok(log.rasterCalls.every((call) => call.attached), "host must be live in the document while rasterizing");
  // The clone must be re-parked on-canvas or html-to-image clips to nothing.
  assert.deepEqual(log.rasterCalls[0].options, { pixelRatio: 1, style: { position: "static", left: "0", top: "0" } });

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

test("variant defaults to the scene's own variant", async () => {
  const full = makeHarness();
  await exportGrowthGif(buildFixtureScene(), "facebook", "react", {}, full.deps);
  assert.equal(full.log.frames.length, 100); // fixture scene is variant "full"

  const compactScene = { ...buildFixtureScene(), variant: "compact" };
  const compact = makeHarness();
  await exportGrowthGif(compactScene, "facebook", "react", {}, compact.deps);
  assert.equal(compact.log.frames.length, 60);
});

test("compact export: 60 frames linear across scene seconds 1.2 -> 10, first 0.12 and last 1", async () => {
  const { log, deps } = makeHarness();
  const seen = [];
  await exportGrowthGif(
    buildFixtureScene(),
    "facebook",
    "react",
    { variant: "compact", onProgress: (done, total) => seen.push([done, total]) },
    deps,
  );

  assert.equal(log.frames.length, 60);
  assert.equal(log.rasterCalls.length, 60);
  // Seed frame rasterized first, then frames in order with 35 cached.
  assert.equal(log.rasterCalls[0].frame, 35);
  const rest = log.rasterCalls.slice(1);
  assert.equal(rest.length, 59);
  for (let i = 0; i < rest.length; i += 1) {
    assert.equal(rest[i].frame, i < 35 ? i : i + 1, `rasterization ${i + 1} ran on the wrong frame`);
  }
  const progressOf = (frameIndex) =>
    (frameIndex === 35 ? log.rasterCalls[0] : rest[frameIndex < 35 ? frameIndex : frameIndex - 1]).progress;
  assert.ok(Math.abs(progressOf(0) - 1.2 / 10) < 1e-12, "compact skips the 1.2s hook act");
  assert.ok(Math.abs(progressOf(59) - 1) < 1e-12);
  const step = progressOf(1) - progressOf(0);
  for (let i = 1; i < 60; i += 1) {
    assert.ok(Math.abs(progressOf(i) - progressOf(i - 1) - step) < 1e-12, `frame ${i} broke linearity`);
  }
  // The palette seed stays frame 35 of the frame list even in compact.
  assert.ok(Math.abs(progressOf(35) - ((1.2 + (35 / 59) * 8.8) / 10)) < 1e-12);
  assert.deepEqual(seen[seen.length - 1], [60, 60]);
});

test("palette: quantized exactly once from the seed frame and reused for every frame", async () => {
  const { log, deps, palette } = makeHarness();
  await exportGrowthGif(buildFixtureScene(), "facebook", "react", { variant: "full" }, deps);

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
        variant: "full",
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
  const result = await exportGrowthGif(buildFixtureScene(), "vercel", "next.js", { variant: "compact" }, deps);
  assert.equal(result.filename, "octocounts-vercel-next.js-growth.gif");
});
