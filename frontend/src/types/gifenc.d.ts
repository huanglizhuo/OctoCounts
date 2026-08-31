// gifenc ships no type declarations (plain JS package). This covers only the
// functions StarHistoryChart actually calls; see
// https://github.com/mattdesl/gifenc for the full API.
declare module "gifenc" {
  export type RgbColor = [number, number, number];
  export type RgbaColor = [number, number, number, number];

  export interface GifWriteFrameOptions {
    palette?: RgbColor[] | RgbaColor[];
    delay?: number;
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
    colorDepth?: number;
    dispose?: number;
    first?: boolean;
  }

  export interface GifEncoderInstance {
    writeFrame(
      indexedPixels: Uint8Array,
      width: number,
      height: number,
      options?: GifWriteFrameOptions
    ): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
  }

  export function GIFEncoder(options?: { initialCapacity?: number; auto?: boolean }): GifEncoderInstance;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: string; clearAlpha?: boolean }
  ): RgbColor[] | RgbaColor[];

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: RgbColor[] | RgbaColor[],
    format?: string
  ): Uint8Array;
}
