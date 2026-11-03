export type ExploreKind = "stats" | "recent" | "popular" | "monoliths" | "trending";

export function exploreKind(path: string): ExploreKind | undefined {
  switch (path) {
    case "/stats": return "stats";
    case "/recent": return "recent";
    case "/popular": return "popular";
    case "/hall-of-monoliths": return "monoliths";
    case "/trending": return "trending";
  }
}

type Pages = typeof import("./ExploreApp");
let pages: Pages | undefined;
let pending: Promise<Pages> | undefined;

export function loadedExplorePages() { return pages; }

export function loadExplorePages(): Promise<Pages> {
  if (!pending) {
    pending = new Promise<Pages>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Page module timed out")), 15_000);
      import("./ExploreApp").then(resolve, reject).finally(() => clearTimeout(timer));
    }).then((module) => { pages = module; return module; });
  }
  return pending;
}
