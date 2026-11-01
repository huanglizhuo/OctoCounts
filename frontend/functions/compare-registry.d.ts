type CuratedComparison = {
  slug: string;
  name: string;
  left: { owner: string; repo: string; ref?: string };
  right: { owner: string; repo: string; ref?: string };
};

// Pages Functions compiles .d.ts files too: `declare` keeps this constant
// valid for that build (an uninitialized `export const` fails it).
export declare const COMPARE_REGISTRY: ReadonlyArray<CuratedComparison>;
export function findCuratedComparison(slug: string): CuratedComparison | null;
export function relatedComparisons(repoFullName: string, topLanguageName?: string | null): CuratedComparison[];
