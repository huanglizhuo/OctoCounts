// Curated framework/tool comparison registry.
//
// Each entry maps one stable /compare/<slug> route to an explicit pair of
// public GitHub repositories. Pairs are hand-picked for high-intent
// "X vs Y lines of code" queries; no arbitrary permutations are generated.
// Both sides of every pair are seeded in data/popular-repos.txt and have
// cached OctoCounts reports, so the SSR pages render from cache.
// An optional `ref` pins a branch/tag/SHA; when omitted the default branch
// report is used.
export const COMPARE_REGISTRY = [
  { slug: "react-vs-vue", name: "React vs Vue", left: { owner: "facebook", repo: "react" }, right: { owner: "vuejs", repo: "core" } },
  { slug: "angular-vs-react", name: "Angular vs React", left: { owner: "angular", repo: "angular" }, right: { owner: "facebook", repo: "react" } },
  { slug: "svelte-vs-react", name: "Svelte vs React", left: { owner: "sveltejs", repo: "svelte" }, right: { owner: "facebook", repo: "react" } },
  { slug: "nextjs-vs-react-router", name: "Next.js vs React Router", left: { owner: "vercel", repo: "next.js" }, right: { owner: "remix-run", repo: "react-router" } },
  { slug: "vite-vs-webpack", name: "Vite vs webpack", left: { owner: "vitejs", repo: "vite" }, right: { owner: "webpack", repo: "webpack" } },
  { slug: "fastify-vs-express", name: "Fastify vs Express", left: { owner: "fastify", repo: "fastify" }, right: { owner: "expressjs", repo: "express" } },
  { slug: "nestjs-vs-express", name: "NestJS vs Express", left: { owner: "nestjs", repo: "nest" }, right: { owner: "expressjs", repo: "express" } },
  { slug: "deno-vs-node", name: "Deno vs Node.js", left: { owner: "denoland", repo: "deno" }, right: { owner: "nodejs", repo: "node" } },
  { slug: "pnpm-vs-yarn", name: "pnpm vs Yarn", left: { owner: "pnpm", repo: "pnpm" }, right: { owner: "yarnpkg", repo: "berry" } },
  { slug: "tensorflow-vs-pytorch", name: "TensorFlow vs PyTorch", left: { owner: "tensorflow", repo: "tensorflow" }, right: { owner: "pytorch", repo: "pytorch" } },
  { slug: "electron-vs-tauri", name: "Electron vs Tauri", left: { owner: "electron", repo: "electron" }, right: { owner: "tauri-apps", repo: "tauri" } },
  { slug: "react-native-vs-flutter", name: "React Native vs Flutter", left: { owner: "facebook", repo: "react-native" }, right: { owner: "flutter", repo: "flutter" } },
  { slug: "rust-vs-go", name: "Rust vs Go", left: { owner: "rust-lang", repo: "rust" }, right: { owner: "golang", repo: "go" } },
  { slug: "mongodb-vs-postgres", name: "MongoDB vs PostgreSQL", left: { owner: "mongodb", repo: "mongo" }, right: { owner: "postgres", repo: "postgres" } },
  { slug: "grafana-vs-kibana", name: "Grafana vs Kibana", left: { owner: "grafana", repo: "grafana" }, right: { owner: "elastic", repo: "kibana" } },
  { slug: "terraform-vs-ansible", name: "Terraform vs Ansible", left: { owner: "hashicorp", repo: "terraform" }, right: { owner: "ansible", repo: "ansible" } },
];

export function findCuratedComparison(slug) {
  return COMPARE_REGISTRY.find((entry) => entry.slug === slug) || null;
}
