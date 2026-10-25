// Editorial notes for the first batch of curated comparison pages (SG-05).
// One entry per slug; entries beyond this batch simply have no entry and the
// pages render exactly as before. Every statement must be supported by the
// page's own counted data or by the linked source — no "better/advanced"
// verdicts, no size-to-quality or size-to-performance leaps.
//
// Fields:
//   scope      — what the two repositories contain and whether the counts are
//                comparable (dates/config live in the page's methodology line)
//   insights   — 2-3 data-supported readings of the counted numbers
//   caution    — the misreading this page is most likely to invite
//   sources    — external references for structure/architecture statements
//   verifiedAt — date the non-data statements were last checked
export const COMPARE_EDITORIAL = {
  "react-vs-vue": {
    scope:
      "Repository layout before counting filters: react/react is a monorepo: the source repository is the React packages plus fixtures, documentation site content, and test infrastructure, not just the react package that ships to apps. vuejs/core is the Vue core repository — the runtime, compiler, and reactivity packages — with its own tests and docs. Both repositories are framework source trees, not applications built with them, and the two archives were counted on the dates shown in the methodology line above.",
    insights: [
      "Vue core includes runtime, compiler, and reactivity packages; React includes its own packages and supporting infrastructure. The current per-language tables describe the selected snapshots and filters, not the language mix of an application built with either framework.",
    ],
    caution:
      "Neither number predicts the size, performance, or quality of an app built with the framework: a bundled application includes a compiled subset of the framework, application code, and dependencies. Use these counts to gauge how much framework source exists to read and maintain.",
    sources: [
      { label: "react/react repository structure (packages/ monorepo)", url: "https://github.com/react/react" },
      { label: "vuejs/core repository", url: "https://github.com/vuejs/core" },
    ],
    verifiedAt: "2026-10-16",
  },
  "vite-vs-webpack": {
    scope:
      "Repository layout before counting filters: vitejs/vite is the Vite core repository — dev server, build pipeline, and their plugin/rollup integration — while webpack/webpack is the webpack core; loaders, plugins, and the surrounding ecosystems live in separate repositories for both tools. The two repositories contain core-tool source trees, counted on the dates in the methodology line.",
    insights: [
      "Vite and webpack maintain their core build tooling separately from much of their plugin ecosystems. Compare the selected source trees and filtering rules before treating a difference in language totals as a difference in tool scope.",
    ],
    caution:
      "These counts do not measure build speed or output size for your project: performance depends on the toolchain version, plugin set, and application shape. A smaller tool source tree does not build faster.",
    sources: [
      { label: "vitejs/vite repository", url: "https://github.com/vitejs/vite" },
      { label: "webpack/webpack repository", url: "https://github.com/webpack/webpack" },
    ],
    verifiedAt: "2026-09-08",
  },
  "nextjs-vs-vite": {
    scope:
      "Repository layout before counting filters: vercel/next.js is the Next.js monorepo — the framework packages, examples, documentation site, and test suites — while vitejs/vite is the Vite core repository only. The comparison is framework-repository vs build-tool-repository: related layers of the stack, but not the same kind of software, and the contains were taken on the dates shown above.",
    insights: [
      "The two counts describe different layers: Next.js is a framework that orchestrates rendering, routing, and data loading (and uses build tooling underneath), while Vite is that build tooling layer. Reading the numbers side by side is most useful as a sense of each project's reading and maintenance surface.",
    ],
    caution:
      "This is not a framework-vs-build-tool performance or popularity comparison. Source-tree size says nothing about which to choose; the decision depends on the application's rendering and build requirements.",
    sources: [
      { label: "vercel/next.js repository structure (monorepo with examples and docs)", url: "https://github.com/vercel/next.js" },
      { label: "vitejs/vite repository", url: "https://github.com/vitejs/vite" },
    ],
    verifiedAt: "2026-09-08",
  },
  "electron-vs-tauri": {
    scope:
      "Repository layout before counting filters: electron/electron is the Electron repository: the embedded Chromium and Node.js integration layer, native shell code, API implementation, and documentation — but not Chromium's or Node's own source, which are consumed as prebuilt binaries. tauri-apps/tauri is the Tauri core repository: the Rust runtime, the process and IPC layer, and the CLI tooling; it equally does not count the system webview it delegates to. Both repositories are the glue layer each project maintains, not the browser engines involved.",
    insights: [
      "Electron exposes a JavaScript API over native integration code, while Tauri uses a Rust core to connect web content to the operating system. The selected snapshots determine how these layers appear in each report's language totals.",
      "The engine asymmetry matters when reading the totals: Electron bundles Chromium with each app, while Tauri relies on the operating system's webview, so neither repository's SLOC represents what ships inside a finished desktop app.",
    ],
    caution:
      "Repository size is not install size and not memory footprint. A finished app's weight depends on the engine strategy above, not on how many source lines the framework repository contains.",
    sources: [
      { label: "electron/electron repository", url: "https://github.com/electron/electron" },
      { label: "tauri-apps/tauri repository", url: "https://github.com/tauri-apps/tauri" },
    ],
    verifiedAt: "2026-09-08",
  },
  "rust-vs-go": {
    scope:
      "Repository layout before counting filters: rust-lang/rust is the Rust repository: the compiler (largely Rust itself), standard library, tooling, and a very large test suite. golang/go is the Go repository: compiler toolchain, standard library, and runtime, also with its own test suites. Both are language toolchain monorepos, counted with the rules shown in the methodology on the dates above, which makes this one of the more like-for-like comparisons on this site.",
    insights: [
      "These repositories contain compilers, runtimes, libraries, and supporting tools. A language's share of the selected source tree does not identify which files are bootstrap code or prove that they are hand-written; inspect the pinned tree for those boundaries.",
    ],
    caution:
      "Compiler repository size does not measure language quality, compile speed, or runtime performance — those are properties of the shipped toolchain and the programs it produces, not of the source tree's line count.",
    sources: [
      { label: "rust-lang/rust repository", url: "https://github.com/rust-lang/rust" },
      { label: "golang/go repository", url: "https://github.com/golang/go" },
    ],
    verifiedAt: "2026-09-08",
  },
  "angular-vs-react": {
    scope:
      "Repository layout before counting filters: angular/angular is the Angular framework monorepo: the core framework packages, compiler, and tooling, along with documentation and test suites. react/react is the React monorepo: the React packages plus fixtures, documentation site content, and test infrastructure. Both repositories are framework source trees, counted on the dates shown in the methodology line; Angular's CLI and wider tooling ecosystem live in separate repositories.",
    insights: [
      "Angular and React package their framework internals differently. The selected reports show their implementation-language totals; those totals do not establish what language an application must use or when a project adopted TypeScript.",
    ],
    caution:
      "Neither number predicts the size, performance, or quality of an app built with the framework: a bundled application contains a compiled subset of the framework, application code, and dependencies. Use these counts to gauge the reading and maintenance surface of each framework source tree.",
    sources: [
      { label: "angular/angular repository (framework monorepo)", url: "https://github.com/angular/angular" },
      { label: "react/react repository structure (packages/ monorepo)", url: "https://github.com/react/react" },
    ],
    verifiedAt: "2026-10-16",
  },
  "svelte-vs-react": {
    scope:
      "Repository layout before counting filters: sveltejs/svelte is the Svelte monorepo: the compiler, runtime packages, tests, and documentation, while react/react is the React monorepo — the React packages plus fixtures, documentation site content, and test infrastructure. Both repositories are framework source trees, not applications built with them, and both archives were counted on the dates shown in the methodology line above.",
    insights: [
    ],
    caution:
      "The counts say nothing about the size of what ships to a browser: Svelte moves work into build output and React ships a runtime subset, so neither repository's line count tracks bundle size, runtime behavior, or app performance.",
    sources: [
      { label: "sveltejs/svelte repository (compiler and packages)", url: "https://github.com/sveltejs/svelte" },
      { label: "react/react repository structure (packages/ monorepo)", url: "https://github.com/react/react" },
    ],
    verifiedAt: "2026-10-16",
  },
  "nextjs-vs-react-router": {
    scope:
      "Repository layout before counting filters: vercel/next.js is the Next.js monorepo — framework packages, documentation site, examples, and test suites. remix-run/react-router is the React Router repository: the routing library packages, docs, and tests. This is a framework-repository vs library-repository comparison: related layers of the same stack, but not the same kind of software, counted on the dates shown in the methodology line above.",
    insights: [
    ],
    caution:
      "This is not framework-vs-framework: React Router supplies routing and is typically paired with a separate data and build layer, while Next.js bundles those concerns. Neither number indicates which fits an application better.",
    sources: [
      { label: "vercel/next.js repository structure (monorepo with examples and docs)", url: "https://github.com/vercel/next.js" },
      { label: "remix-run/react-router repository", url: "https://github.com/remix-run/react-router" },
    ],
    verifiedAt: "2026-09-16",
  },
  "fastify-vs-express": {
    scope:
      "Repository layout before counting filters: fastify/fastify is the Fastify core repository — the web framework and its plugin system — while expressjs/express is the Express core, the long-standing minimal Node.js web framework whose middleware ecosystem largely lives in separate repositories. Both repositories are of framework source trees rather than of applications built on them, taken on the dates in the methodology line above.",
    insights: [
      "Both repositories expose Node.js web-server APIs, but package their routing, middleware, and supporting code differently. Use the selected per-language totals to compare the measured trees, rather than assuming their language proportions are fixed.",
      "Neither archive includes the wider plugin/middleware ecosystems that both frameworks are known for — much of that code is published from separate repositories — so both counts understate the total library surface a typical application touches.",
    ],
    caution:
      "A smaller framework source tree does not mean a smaller or faster application: request throughput and memory use depend on the application, its middleware chain, and runtime configuration, none of which appear in these counts.",
    sources: [
      { label: "fastify/fastify repository", url: "https://github.com/fastify/fastify" },
      { label: "expressjs/express repository", url: "https://github.com/expressjs/express" },
    ],
    verifiedAt: "2026-09-16",
  },
  "nestjs-vs-express": {
    scope:
      "Repository layout before counting filters: nestjs/nest is the NestJS framework repository: its core packages, platform adapters, sample projects, and documentation — a TypeScript framework that runs on top of an underlying HTTP server library (Express by default). expressjs/express is the Express framework itself, a comparatively minimal JavaScript web framework for Node.js. The two repositories are related layers rather than substitutes, and their measurements were taken on the dates in the methodology line.",
    insights: [
      "NestJS provides a TypeScript-oriented application framework over HTTP adapters, while Express supplies a Node.js web-server and middleware API. Their source trees therefore represent different layers, even when used in the same application.",
      "NestJS ships sample applications and multiple platform packages inside its repository, so part of its count exists to demonstrate and adapt the framework rather than to run as the framework core.",
    ],
    caution:
      "NestJS normally runs on top of Express (or an alternative adapter), so the two counts overlap in the stack rather than compete; neither number says anything about which suits a given application.",
    sources: [
      { label: "nestjs/nest repository", url: "https://github.com/nestjs/nest" },
      { label: "expressjs/express repository", url: "https://github.com/expressjs/express" },
    ],
    verifiedAt: "2026-09-16",
  },
  "deno-vs-node": {
    scope:
      "Repository layout before counting filters: denoland/deno is the Deno runtime repository: the Rust core that embeds V8, the TypeScript/JavaScript runtime and standard-library surface, the CLI, and tooling. nodejs/node is the Node.js repository: the C/C++ runtime and bindings, the JavaScript standard library under lib/, and vendored third-party sources under deps/. Neither count includes V8's own source; both consume it at build time. Both trees were counted on the dates in the methodology line above.",
    insights: [
      "Both runtimes combine native implementation code with higher-level runtime APIs. The language totals depend on the pinned tree and exclusions; they are not measurements of runtime speed or standards coverage.",
      "Node's lib/ directory and Deno's runtime API code are distinct from native bindings and embedded engines. Inspect the pinned tree to determine which layers contribute to a particular count.",
    ],
    caution:
      "These counts do not measure runtime performance, startup time, or compatibility with the existing npm ecosystem — those are properties of the shipped binaries, not of the repositories' line counts.",
    sources: [
      { label: "denoland/deno repository", url: "https://github.com/denoland/deno" },
      { label: "nodejs/node repository", url: "https://github.com/nodejs/node" },
    ],
    verifiedAt: "2026-09-16",
  },
  "pnpm-vs-yarn": {
    scope:
      "Repository layout before counting filters: pnpm/pnpm is the pnpm package manager repository: its core, CLI, and plugin-style subpackages, all maintained as one TypeScript tree. yarnpkg/berry is the Yarn 2+ codebase — the modern Yarn version maintained as a monorepo of its core and published subpackages. Both repositories are therefore package-manager source trees of the same generation, counted on the dates in the methodology line above.",
    insights: [
      "Both package managers maintain installation logic and supporting tooling. Sharing an implementation language does not establish comparable counting rules; compare the declared policies and repository scope alongside the totals.",
    ],
    caution:
      "A smaller source tree does not install dependencies faster or use less disk space: install performance and store layout depend on the released tool's design and on the project being installed, not on repository line counts.",
    sources: [
      { label: "pnpm/pnpm repository", url: "https://github.com/pnpm/pnpm" },
      { label: "yarnpkg/berry repository (Yarn 2+ monorepo)", url: "https://github.com/yarnpkg/berry" },
    ],
    verifiedAt: "2026-09-16",
  },
  "tensorflow-vs-pytorch": {
    scope:
      "Repository layout before counting filters: tensorflow/tensorflow is the TensorFlow monorepo: the C++ runtime and kernels, the Python frontend, XLA, and a large test and example corpus. pytorch/pytorch is the PyTorch core repository: the Python frontend, the ATen/TH C++ and CUDA kernels, and its own tests and tooling. Both are full machine-learning framework source trees, counted on the dates shown in the methodology line above.",
    insights: [
      "Both projects include native compute components and Python-facing APIs. Language totals alone do not distinguish kernels from frontend code or indicate the amount of functionality available to a model author.",
      "The per-language tables show a different center of gravity for each project — TensorFlow's counted code is dominated by C++ (kernels and runtime) while PyTorch's tree leans further toward its Python frontend — which is visible directly in the language breakdown rather than needing to be inferred from the totals.",
    ],
    caution:
      "Repository size does not measure training speed, memory use, or model quality for a given workload — those depend on the kernels exercised and the hardware, not on how many source lines the framework tree contains.",
    sources: [
      { label: "tensorflow/tensorflow repository", url: "https://github.com/tensorflow/tensorflow" },
      { label: "pytorch/pytorch repository", url: "https://github.com/pytorch/pytorch" },
    ],
    verifiedAt: "2026-09-16",
  },
  "react-native-vs-flutter": {
    scope:
      "Repository layout before counting filters: react/react-native is the React Native repository: the framework's JavaScript layer, native modules and components across several native languages, plus docs and test infrastructure. flutter/flutter is the Flutter SDK repository, including framework, tools, and the engine source merged into engine/src/flutter. The two repositories package their native and framework layers differently, so inspect each pinned tree's scope before comparing totals.",
    insights: [
      "React Native bridges JavaScript framework code and native components; Flutter includes its Dart framework and engine sources in one repository. Effective filters determine which files from those layers contribute to the selected reports.",
      "A source archive is not a shipped application: builds may include engine binaries, dependencies, generated output, and assets not represented by the selected source count. Do not infer an equal packaging margin for the two frameworks.",
    ],
    caution:
      "Repository size is not app install size: a finished app includes an engine build, framework code, and assets that these repositories account for differently. Compare the counts as source-tree sizes, not as what ships to a device.",
    sources: [
      { label: "react/react-native repository", url: "https://github.com/react/react-native" },
      { label: "Flutter engine and framework repository merge announcement", url: "https://groups.google.com/g/flutter-announce/c/9J8yZQfForg" },
      { label: "flutter/flutter repository (SDK framework, engine and tools)", url: "https://github.com/flutter/flutter" },
    ],
    verifiedAt: "2026-10-16",
  },
  "mongodb-vs-postgres": {
    scope:
      "Repository layout before counting filters: mongodb/mongo is the MongoDB server repository: the database core in C++, with storage engines and third-party libraries vendored in-tree. postgres/postgres is the PostgreSQL source tree: the backend, planner, executor, and client interfaces, written in C. Both are complete database server source trees measured under the rules and on the dates shown above, making this a like-for-like category comparison.",
    insights: [
      "The per-language tables reflect each project's implementation language directly: MongoDB's counted tree is C++-dominated with vendored components contributing further C and C++, while PostgreSQL's is overwhelmingly C — so the language mix here is a direct readout of each codebase's tradition.",
      "MongoDB's count includes vendored storage-engine and dependency code alongside its own server code, while PostgreSQL's single tree has long contained the whole system — meaning the totals include different amounts of third-party material on each side.",
    ],
    caution:
      "Server source size does not measure query performance, throughput, or operational cost for your workload; those depend on the built system, schema, and configuration, none of which appear in these counts.",
    sources: [
      { label: "mongodb/mongo repository (C++ database server core)", url: "https://github.com/mongodb/mongo" },
      { label: "postgres/postgres repository (C database server source tree)", url: "https://github.com/postgres/postgres" },
    ],
    verifiedAt: "2026-09-16",
  },
  "grafana-vs-kibana": {
    scope:
      "Repository layout before counting filters: grafana/grafana is the Grafana repository: the server backend, the frontend, and a large set of in-tree plugins. elastic/kibana is the Kibana repository: the data-visualization application for the Elastic Stack, including its own plugin modules. Both are full application monorepos rather than libraries, counted on the dates shown above.",
    insights: [
      "The per-language tables reflect each project's shape directly: Grafana's counted code is split between a Go backend and a TypeScript frontend, while Kibana's counted code is predominantly TypeScript for the application and its plugin surface.",
      "Both counts include in-tree plugin and module code, so each total substantially measures extension surface maintained inside the main repository, not only the core application.",
    ],
    caution:
      "These counts describe the visualization applications only. Query execution happens in the data sources they connect to, so neither number says anything about search or analytics engine capability.",
    sources: [
      { label: "grafana/grafana repository (backend, frontend, and in-tree plugins)", url: "https://github.com/grafana/grafana" },
      { label: "elastic/kibana repository", url: "https://github.com/elastic/kibana" },
    ],
    verifiedAt: "2026-09-16",
  },
  "terraform-vs-ansible": {
    scope:
      "Repository layout before counting filters: hashicorp/terraform is the Terraform core repository — the configuration language, state management, plan/apply engine, and built-in providers for its plugin protocol — while ansible/ansible is the Ansible core: the automation engine, modules, and plugin machinery, with most content collections maintained in separate repositories. The two tools sit in adjacent but different categories, so the contains describe different kinds of software rather than two takes on one job.",
    insights: [
      "The language tables show the implementation split directly: Terraform core is a Go codebase, while Ansible core is predominantly Python — each project's chosen language for its domain, visible without any inference from totals.",
      "Ansible's count includes a large module and plugin surface inside the core repository, so its tree size partly reflects how much automation functionality ships from one repository rather than from a registry of collections.",
    ],
    caution:
      "This is not a like-for-like tool comparison: Terraform provisions and manages infrastructure resources declaratively, Ansible automates configuration and tasks across machines. The line counts say nothing about which fits a given workflow.",
    sources: [
      { label: "hashicorp/terraform repository", url: "https://github.com/hashicorp/terraform" },
      { label: "ansible/ansible repository", url: "https://github.com/ansible/ansible" },
    ],
    verifiedAt: "2026-09-16",
  },
  "angular-vs-vue": {
    scope:
      "Repository layout before counting filters: angular/angular is the Angular framework monorepo: framework packages, compiler, tooling, infrastructure, and its test suites. vuejs/core is the Vue core repository — runtime, compiler, and reactivity packages — with its own tests and docs. Both are framework source trees, not applications built with them, counted on the dates shown in the methodology line.",
    insights: [
      "As on the React-vs-Vue page, the language mix differs in kind: the Angular codebase is TypeScript throughout, while Vue core is also predominantly TypeScript — a shared implementation language that makes the two counts unusually comparable in tooling terms.",
    ],
    caution:
      "Neither total predicts the size or performance of an app built with the framework: an application bundles only a compiled subset of its framework plus its own code and dependencies.",
    sources: [
      { label: "angular/angular repository", url: "https://github.com/angular/angular" },
      { label: "vuejs/core repository", url: "https://github.com/vuejs/core" },
    ],
    verifiedAt: "2026-09-16",
  },
  "svelte-vs-vue": {
    scope:
      "Repository layout before counting filters: sveltejs/svelte is the Svelte repository: the compiler, the client runtime, documentation, and test suites, organized as a monorepo of packages. vuejs/core is the Vue core: the reactivity system, the runtime renderer, and the template compiler, with its own tests and docs. Both repositories are framework source trees, not applications built with the frameworks, and both were counted on the dates shown above.",
    insights: [
      "The two frameworks concentrate their work at different layers: Svelte's counted code centers on a compile-time transform, while Vue core ships a runtime renderer alongside its compiler — so the totals describe different balances of compile-time and runtime code rather than different amounts of shipped browser code.",
      "Both repositories are written predominantly in TypeScript, as the per-language tables show, so this comparison is less about implementation language than about the shape and scope of the framework code each project maintains.",
    ],
    caution:
      "A larger count does not mean more of the framework ships to a user's browser: what a built application includes depends on compiler output and bundling, not on repository size.",
    sources: [
      { label: "sveltejs/svelte repository", url: "https://github.com/sveltejs/svelte" },
      { label: "vuejs/core repository", url: "https://github.com/vuejs/core" },
    ],
    verifiedAt: "2026-09-16",
  },
  "neovim-vs-vscode": {
    scope:
      "Repository layout before counting filters: neovim/neovim is the Neovim editor core: a C codebase with an extensive Lua and Vimscript runtime directory of bundled plugins, syntax files, and documentation. microsoft/vscode is the VS Code product repository — a predominantly TypeScript Electron application with its build scripts, test suites, and product scaffolding. The two repositories are not directly comparable: one is an editor core, the other a full product tree.",
    insights: [
      "The per-language tables show the two editors' different implementation choices directly: Neovim's counted tree is dominated by C with a large runtime layer of Lua and Vimscript, while VS Code's is dominated by TypeScript as an Electron application.",
    ],
    caution:
      "These counts do not measure which editor is more capable or which one you should use: the two repositories package different scopes of software, and editor capability depends on extensions and configuration either way.",
    sources: [
      { label: "neovim/neovim repository", url: "https://github.com/neovim/neovim" },
      { label: "microsoft/vscode repository", url: "https://github.com/microsoft/vscode" },
    ],
    verifiedAt: "2026-09-16",
  },
  "kubernetes-vs-docker-compose": {
    scope:
      "Repository layout before counting filters: kubernetes/kubernetes is the Kubernetes core monorepo: API server, scheduler, kubelet, controllers, client libraries, and a substantial amount of generated code and tests. docker/compose is the Compose CLI — the single tool that defines and runs multi-container applications, written in Go. The two repositories are different kinds of software at different scales, and the contains were taken on the dates shown above.",
    insights: [
      "Both counted trees are predominantly Go as the per-language tables show, which makes the language mix unremarkable here and puts the entire weight of the difference on repository scope rather than implementation language.",
    ],
    caution:
      "Do not read this as a Kubernetes-replaces-Compose (or vice versa) verdict from the numbers: Compose targets local multi-container development, Kubernetes targets cluster orchestration. The smaller count does not mean the smaller tool is insufficient for its own use case.",
    sources: [
      { label: "kubernetes/kubernetes repository (core monorepo)", url: "https://github.com/kubernetes/kubernetes" },
      { label: "docker/compose repository", url: "https://github.com/docker/compose" },
    ],
    verifiedAt: "2026-09-16",
  },
  "kubernetes-vs-terraform": {
    scope:
      "Repository layout before counting filters: kubernetes/kubernetes is the Kubernetes core repository: the API server, scheduler, controller machinery, kubelet, and the client and staging packages, all in one Go monorepo. hashicorp/terraform is the Terraform core repository: the configuration language, state machinery, plan/apply engine, and CLI; the provider plugins that talk to cloud APIs live in separate repositories. Both repositories are a core system written predominantly in Go, counted on the dates shown above.",
    insights: [
      "The per-language tables are dominated by Go on both sides, which makes this one of the more like-for-like comparisons on the site in implementation language; what differs is what each core excludes, since Terraform's providers sit in many separate repositories while Kubernetes counts its in-tree components.",
    ],
    caution:
      "These counts do not measure cluster resource footprint, operational complexity, or how much code an end user manages — a Terraform configuration can provision a Kubernetes cluster whose own codebase dwarfs the configuration. The numbers describe the two core repositories only.",
    sources: [
      { label: "kubernetes/kubernetes repository (core components)", url: "https://github.com/kubernetes/kubernetes" },
      { label: "hashicorp/terraform repository (core; providers live separately)", url: "https://github.com/hashicorp/terraform" },
    ],
    verifiedAt: "2026-09-16",
  },
  "prometheus-vs-grafana": {
    scope:
      "Repository layout before counting filters: prometheus/prometheus is the Prometheus monitoring server: scraping, the TSDB storage engine, the PromQL query engine, alerting, and web UI — a single-repository Go server. grafana/grafana is the Grafana observability platform: a Go backend plus a TypeScript frontend with its plugin system. The comparison is therefore a backend-only server against a full-stack application, counted with the rules shown above.",
    insights: [
      "Prometheus's counted tree is predominantly Go because the entire server — including its own time-series database and query engine — lives in one repository; Grafana's per-language table shows the Go/TypeScript split of a platform that delegates storage to external datasources instead of embedding one.",
    ],
    caution:
      "The totals describe different scopes of responsibility: Prometheus ships its storage engine in-repo while Grafana connects to storage elsewhere. A larger or smaller count here does not map to capability, and neither number measures the resource cost of running either system.",
    sources: [
      { label: "prometheus/prometheus repository (server, TSDB, and query engine)", url: "https://github.com/prometheus/prometheus" },
      { label: "grafana/grafana repository", url: "https://github.com/grafana/grafana" },
    ],
    verifiedAt: "2026-09-16",
  },
  "nestjs-vs-fastify": {
    scope:
      "Repository layout before counting filters: nestjs/nest is the NestJS monorepo: the framework packages, its tooling, and sample material, written predominantly in TypeScript. fastify/fastify is the Fastify core repository — the HTTP framework, its plugins within the core repo, and tests — written predominantly in JavaScript. The two sit at different layers: NestJS is an architecture framework that can delegate HTTP serving to a Node.js HTTP framework such as Fastify or Express.",
    insights: [
      "The per-language tables show the implementation-language split plainly: NestJS is a TypeScript codebase, while Fastify core remains largely JavaScript — a reflection of each project's chosen source language rather than a difference in capability.",
      "NestJS's count includes framework abstractions over HTTP, routing, and dependency injection, whereas Fastify's count is the HTTP framework layer those abstractions build on, so the two totals describe adjacent parts of a stack rather than rivals at one layer.",
    ],
    caution:
      "Because NestJS can run on top of Fastify, the two repositories are not competitors in the count: reading the totals as framework-vs-framework size misses that one can contain the other at runtime.",
    sources: [
      { label: "nestjs/nest repository (framework monorepo)", url: "https://github.com/nestjs/nest" },
      { label: "fastify/fastify repository", url: "https://github.com/fastify/fastify" },
    ],
    verifiedAt: "2026-09-16",
  },
  "prettier-vs-eslint": {
    scope:
      "Repository layout before counting filters: prettier/prettier is the Prettier repository — the opinionated code formatter and its bundled language support — while eslint/eslint is the ESLint core linter; ESLint's large rule/plugin ecosystem mostly lives in separate repositories, as do Prettier's standalone plugins. The contains are therefore comparable as core-tooling source trees, taken on the dates shown in the methodology line.",
    insights: [
      "Both repositories are implemented predominantly in JavaScript, per the per-language tables; the contrast on the page is one of codebase size, not of implementation approach.",
      "Prettier's repository carries a substantial share of formatter support for many languages, while ESLint's core is scoped to JavaScript-family linting with an extension API — so part of the size difference reflects how much language coverage each core chooses to own.",
    ],
    caution:
      "Formatter and linter are complementary, not competing, tools: ESLint flags patterns against rules, Prettier rewrites formatting. These counts cannot rank them, and many projects use both together.",
    sources: [
      { label: "prettier/prettier repository", url: "https://github.com/prettier/prettier" },
      { label: "eslint/eslint repository", url: "https://github.com/eslint/eslint" },
    ],
    verifiedAt: "2026-09-16",
  },
  "godot-vs-bevy": {
    scope:
      "Repository layout before counting filters: godotengine/godot is the Godot engine repository: the C++ engine core, editor, built-in scripting-language support, and documentation, together with its test and template material. bevyengine/bevy is the Bevy engine repository: a collection of Rust crates forming the engine and its examples. Both are full game-engine source trees, counted on the dates in the methodology line.",
    insights: [
      "The per-language tables state the architectural contrast plainly: Godot's counted code is dominated by C++, while Bevy's is Rust — each project's chosen systems language for the same role of engine core.",
      "Godot's repository includes the editor and its user-facing tooling, whereas Bevy's repository is organized as modular crates with examples, so the two counts are distributed differently across engine subsystems even where their scope overlaps.",
    ],
    caution:
      "Engine repository size is not a measure of what a finished game ships, and not a measure of editor features: both engines are typically used with additional assets, plugins, and — in Bevy's case — an external editor workflow.",
    sources: [
      { label: "godotengine/godot repository", url: "https://github.com/godotengine/godot" },
      { label: "bevyengine/bevy repository", url: "https://github.com/bevyengine/bevy" },
    ],
    verifiedAt: "2026-09-16",
  },
  "bootstrap-vs-tailwind": {
    scope:
      "Repository layout before counting filters: twbs/bootstrap is the Bootstrap repository: the SCSS source for its component styles, the CSS build pipeline, and the JavaScript plugins that accompany those components. tailwindlabs/tailwindcss is the Tailwind CSS repository: the utility-CSS engine and its build tooling, core plugins, and documentation. Both are CSS-framework source trees, counted on the dates in the methodology line above.",
    insights: [
      "The per-language tables reflect each project's center of gravity: Bootstrap's count is dominated by SCSS and component JavaScript — hand-maintained component styles — while Tailwind CSS's count centers on the engine and tooling that generate utility CSS at build time.",
    ],
    caution:
      "These numbers say nothing about the CSS weight a real project ends up with: that depends on which components or utilities are used and on build-time compilation or purging, not on framework repository size.",
    sources: [
      { label: "twbs/bootstrap repository", url: "https://github.com/twbs/bootstrap" },
      { label: "tailwindlabs/tailwindcss repository", url: "https://github.com/tailwindlabs/tailwindcss" },
    ],
    verifiedAt: "2026-09-16",
  },
  "django-vs-rails": {
    scope:
      "Repository layout before counting filters: django/django is the Django framework repository — the Python web framework, its bundled contrib apps, documentation source, and test suite. rails/rails is the Ruby on Rails repository — the Rails framework's core components (Active Record, Action Pack, and the other constituent modules) with their tests. Both repositories are full web-framework source trees, counted on the dates shown above.",
    insights: [
      "The language tables make the comparison structurally simple: Django's counted tree is Python, and Rails' counted tree is Ruby, so the totals measure two framework codebases in their respective implementation languages.",
    ],
    caution:
      "Framework repository size does not predict application performance or development speed for your project: a production app adds its own code, third-party gems/packages, and configuration on top of a small subset of the framework.",
    sources: [
      { label: "django/django repository", url: "https://github.com/django/django" },
      { label: "rails/rails repository", url: "https://github.com/rails/rails" },
    ],
    verifiedAt: "2026-09-16",
  },
  "laravel-vs-django": {
    scope:
      "Repository layout before counting filters: laravel/laravel is the Laravel application skeleton — the starter project a developer installs and builds on — not the framework code itself, which lives in the separate laravel/framework package. django/django is the Django framework repository in full. The two repositories therefore measure different things: a minimal starter template versus a complete web framework, counted on the dates in the methodology line.",
    insights: [
      "The lopsided totals here are a repository-boundary artifact: the Laravel side counts a thin application scaffold while the Django side counts the whole framework, so the gap between the numbers says little about the frameworks themselves.",
      "Both ecosystems' actual framework code is larger than what is shown on the left: Laravel's components ship as dependencies (the laravel/framework package and its Illuminate sub-packages), which this page does not count.",
    ],
    caution:
      "The most likely misreading is treating this as Laravel-is-tiny: the left number is a starter repo, not the framework. For a framework-to-framework reading, the counted Django tree should be compared against the laravel/framework package, which is not the repository paired on this page.",
    sources: [
      { label: "laravel/laravel repository (application skeleton)", url: "https://github.com/laravel/laravel" },
      { label: "django/django repository", url: "https://github.com/django/django" },
    ],
    verifiedAt: "2026-09-16",
  },
  "bun-vs-node": {
    scope:
      "Repository layout before counting filters: oven-sh/bun is the Bun repository: the JavaScript/TypeScript runtime and toolkit, written predominantly in Zig with C++ components, on top of the JavaScriptCore engine it builds against. nodejs/node is the Node.js repository: the runtime built on V8, with its C++ core, JavaScript standard library, and test suites. Both are JavaScript runtime source trees, but the per-language tables show different implementation languages, and both repositories were taken on the dates above.",
    insights: [
      "The language split is the headline of this comparison: Bun's counted code is predominantly Zig, while Node.js's is predominantly C++ with a large JavaScript layer — each project's chosen implementation language for the same job of hosting JavaScript.",
    ],
    caution:
      "Repository size says nothing about runtime speed, memory use, or compatibility with existing packages — those are properties of the shipped runtimes, and both projects change quickly. Treat the counts as a measure of each source tree's reading and maintenance surface.",
    sources: [
      { label: "oven-sh/bun repository", url: "https://github.com/oven-sh/bun" },
      { label: "nodejs/node repository", url: "https://github.com/nodejs/node" },
    ],
    verifiedAt: "2026-09-16",
  },
  "bun-vs-deno": {
    scope:
      "Repository layout before counting filters: oven-sh/bun is the Bun repository: the JavaScript runtime, bundler, test runner, and package manager, written in Zig around a vendored JavaScriptCore/WebKit tree. denoland/deno is the Deno repository: the runtime, built in Rust on top of V8, with its standard library and toolchain. Both are all-in-one runtime monorepos, counted on the dates shown in the methodology line above.",
    insights: [
      "The per-language tables show the implementation-language contrast directly — Zig-dominated on one side, Rust-dominated on the other — which is the counting-engine equivalent of each project's well-known choice of systems language.",
    ],
    caution:
      "Both trees include third-party dependency code alongside the project's own — Bun notably vendors the WebKit/JSC engine it runs on — so these totals are not 'lines written by the project', and they say nothing about runtime speed or memory use.",
    sources: [
      { label: "oven-sh/bun repository (Zig runtime and vendored WebKit)", url: "https://github.com/oven-sh/bun" },
      { label: "denoland/deno repository (Rust runtime on V8)", url: "https://github.com/denoland/deno" },
    ],
    verifiedAt: "2026-09-16",
  },
  "esbuild-vs-swc": {
    scope:
      "Repository layout before counting filters: evanw/esbuild is the esbuild repository: a bundler, minifier, and JavaScript/TypeScript toolchain written in Go. swc-project/swc is the SWC repository: a compiler and toolchain written in Rust, with its JavaScript/TypeScript packages alongside the native core. Both are single-purpose build-tool repositories with their tests and bindings in-tree, counted on the dates above.",
    insights: [
      "Each per-language table reduces to essentially one row: esbuild's counted code is Go, and SWC's counted code is predominantly Rust, so the totals read directly as the size of each single-language toolchain implementation.",
    ],
    caution:
      "Repository size here says nothing about build speed or output size: both tools advertise native-code performance, which is a property of the shipped binaries and the code they process, not of the source line counts on this page.",
    sources: [
      { label: "evanw/esbuild repository (Go toolchain)", url: "https://github.com/evanw/esbuild" },
      { label: "swc-project/swc repository (Rust core with TypeScript/JavaScript packages)", url: "https://github.com/swc-project/swc" },
    ],
    verifiedAt: "2026-09-16",
  },
  "nuxt-vs-nextjs": {
    scope:
      "Repository layout before counting filters: nuxt/nuxt is the Nuxt monorepo — the Vue-based full-stack framework packages along with their documentation and example material — while vercel/next.js is the Next.js monorepo, the React-based full-stack framework with its own docs, examples, and test suites. Both repositories are framework monorepos of the same architectural role, counted with the rules shown above, which makes this one of the more like-for-like comparisons on this site.",
    insights: [
      "The per-language tables show both repositories are TypeScript-led codebases, matching how each framework presents its public APIs — the difference on the page is in tree size and composition, not in implementation language.",
    ],
    caution:
      "Framework repository size does not predict application bundle size, rendering performance, or hosting cost: a deployed site includes only a compiled subset of the framework plus application code and dependencies.",
    sources: [
      { label: "nuxt/nuxt repository structure (framework monorepo)", url: "https://github.com/nuxt/nuxt" },
      { label: "vercel/next.js repository structure (monorepo with examples and docs)", url: "https://github.com/vercel/next.js" },
    ],
    verifiedAt: "2026-09-16",
  },
  "astro-vs-nextjs": {
    scope:
      "Repository layout before counting filters: withastro/astro is the Astro core repository: the static-site generator, its rendering and island integrations, and the documentation included in the repo. vercel/next.js is the Next.js monorepo — framework packages, examples, documentation site, and test suites. Both are framework repositories aimed at web content, but organized differently, and the contains were taken on the dates shown above.",
    insights: [
      "Astro's counted code is written predominantly in TypeScript, as is Next.js's — the per-language tables show two projects in the same implementation language with different repository organization rather than different languages.",
    ],
    caution:
      "Both counts describe framework source trees, not the sites built with them; output size and runtime behavior of a site depend on its own content, components, and configuration, not on these repository totals.",
    sources: [
      { label: "withastro/astro repository", url: "https://github.com/withastro/astro" },
      { label: "vercel/next.js repository structure (monorepo with examples and docs)", url: "https://github.com/vercel/next.js" },
    ],
    verifiedAt: "2026-09-16",
  },
  "solidjs-vs-react": {
    scope:
      "Repository layout before counting filters: solidjs/solid is the Solid repository: the reactive runtime, the JSX transform/compiler packages, and supporting packages in a monorepo, with tests and documentation. react/react is the React monorepo: the React packages plus fixtures, documentation site content, and test infrastructure. Both repositories are framework source trees, not applications built with them, and both were counted on the dates shown above.",
    insights: [
      "The two runtimes are organized around different update models — Solid around fine-grained reactive primitives, React around a scheduler-driven runtime — an architectural difference the counts themselves cannot express, so the totals are best read as maintenance surface.",
    ],
    caution:
      "Repository size does not predict the bundle size shipped to a browser or runtime behavior; a compiled application contains only the parts of the framework it actually uses.",
    sources: [
      { label: "solidjs/solid repository", url: "https://github.com/solidjs/solid" },
      { label: "react/react repository structure (packages/ monorepo)", url: "https://github.com/react/react" },
    ],
    verifiedAt: "2026-10-16",
  },
  "redux-vs-zustand": {
    scope:
      "Repository layout before counting filters: reduxjs/redux is the Redux core repository — the state container library, its documentation, and tests. pmndrs/zustand is the Zustand repository — the small state management library, its middleware, docs, and tests. Both are client-side state management libraries rather than frameworks, which makes the two repositories broadly comparable as library source trees.",
    insights: [
      "Both counted trees are small relative to framework repositories, which is visible directly in the totals: each library implements one focused responsibility — predictable state updates for Redux, minimal hook-based state for Zustand — rather than a full stack.",
    ],
    caution:
      "Smaller does not mean sufficient or insufficient for your use case: the counts say nothing about which state model fits an application — that depends on the app's data flow, team conventions, and ecosystem integrations.",
    sources: [
      { label: "reduxjs/redux repository", url: "https://github.com/reduxjs/redux" },
      { label: "pmndrs/zustand repository", url: "https://github.com/pmndrs/zustand" },
    ],
    verifiedAt: "2026-09-16",
  },
  "vuex-vs-pinia": {
    scope:
      "Repository layout before counting filters: vuejs/vuex contains Vuex — the state-management library that preceded Pinia in the Vue ecosystem — including its core, tests, and documentation. vuejs/pinia contains Pinia, the state store that the Vue documentation now presents as the default recommendation, with its own core, tests, and docs. Both are Vue-ecosystem state-management source trees, counted on the dates shown above.",
    insights: [
      "The two repositories solve the same problem for the same framework, which makes this one of the more like-for-like comparisons on the site: the counts describe two successive libraries' reading and maintenance surface rather than different layers of a stack.",
      "Both trees are written predominantly in TypeScript as the per-language tables show, reflecting that Pinia was developed in the Vue 3 era and Vuex's later major releases followed the same implementation language.",
    ],
    caution:
      "Line count should not be used to declare a successor or a winner: the Vue documentation's recommendation of Pinia is a project-level statement, and neither the totals nor the language shares are evidence about which store fits a given application.",
    sources: [
      { label: "vuejs/vuex repository", url: "https://github.com/vuejs/vuex" },
      { label: "vuejs/pinia repository", url: "https://github.com/vuejs/pinia" },
    ],
    verifiedAt: "2026-09-16",
  },
  "jest-vs-vitest": {
    scope:
      "Repository layout before counting filters: jestjs/jest is the Jest monorepo: the test runner, expect matchers, mocking and snapshot machinery, reporters, and the family of packages around them. vitest-dev/vitest is the Vitest repository: the runner and its core integrations, written in TypeScript. Both repositories are test-runner source trees, counted on the dates in the methodology line; the broader ecosystems and environment adapters for both tools live partly elsewhere.",
    insights: [
    ],
    caution:
      "These counts do not predict test execution speed, memory use, or which runner fits a project; those depend on the runner version, the transform and environment setup, and the test suite itself. Read the numbers as the maintenance surface of each tool.",
    sources: [
      { label: "jestjs/jest repository (packages monorepo)", url: "https://github.com/jestjs/jest" },
      { label: "vitest-dev/vitest repository", url: "https://github.com/vitest-dev/vitest" },
    ],
    verifiedAt: "2026-09-16",
  },
  "cypress-vs-playwright": {
    scope:
      "Repository layout before counting filters: cypress-io/cypress is the Cypress monorepo: the browser driver, the Electron-based desktop runner app, CLI, and their test suites. microsoft/playwright is the Playwright repository: the browser automation library and test runner, including its Node.js, Python, .NET, and Java language ports in one tree. Both were counted on the dates shown above, but the two trees have different internal shapes.",
    insights: [
      "Playwright's per-language table is polyglot by design — the repository maintains client libraries for several languages in parallel — while Cypress's counted code is concentrated in TypeScript/JavaScript, so the language mix partly measures how many language bindings a project keeps in one repo.",
    ],
    caution:
      "Repository size does not measure test execution speed, flakiness, or browser support — and because Playwright's count spans multiple language ports while Cypress's spans a desktop app, the totals are not directly like-for-like either.",
    sources: [
      { label: "cypress-io/cypress repository (driver and desktop runner)", url: "https://github.com/cypress-io/cypress" },
      { label: "microsoft/playwright repository (multi-language automation library)", url: "https://github.com/microsoft/playwright" },
    ],
    verifiedAt: "2026-09-16",
  },
  "prisma-vs-typeorm": {
    scope:
      "Repository layout before counting filters: prisma/orm is the Prisma monorepo: the query-engine and schema-engine code written in Rust, the TypeScript client and CLI packages, plus tests and documentation. typeorm/typeorm is the TypeORM repository — the ORM source, largely a TypeScript codebase, with its own tests and docs. Both are ORMs for the Node.js/TypeScript ecosystem, but their repositories partition the work differently, and the contains were taken on the dates shown above.",
    insights: [
      "The per-language tables make the structural difference visible: Prisma's counted tree mixes a Rust engine core with TypeScript client code, while TypeORM's counted tree is overwhelmingly TypeScript, so the two totals are not the same kind of artifact.",
    ],
    caution:
      "Neither count includes the code an application actually loads in full: ORM usage involves generated clients, runtime drivers, and dependencies that live outside these repositories, so the totals cannot be read as application-side footprint.",
    sources: [
      { label: "prisma/orm repository (monorepo with Rust engines and TypeScript client)", url: "https://github.com/prisma/orm" },
      { label: "typeorm/typeorm repository", url: "https://github.com/typeorm/typeorm" },
    ],
    verifiedAt: "2026-10-16",
  },
  "prisma-vs-drizzle": {
    scope:
      "Repository layout before counting filters: prisma/orm is the Prisma monorepo: the schema language and client tooling, the query engine, and their integration surfaces. drizzle-team/drizzle-orm is the Drizzle ORM repository — the TypeScript query-builder library and its dialect support. Prisma ships a standalone query engine binary as part of its architecture, while Drizzle is a library that works through database drivers, so the two repositories cover somewhat different layers of an ORM stack.",
    insights: [
      "The per-language tables reflect the architectural split: Prisma's counted tree includes a substantial Rust component for its query engine alongside TypeScript tooling, while Drizzle's counted code is essentially all TypeScript — an engine-vs-driver design difference made visible by language mix rather than totals.",
      "Because Prisma's repository includes engine and tooling packages and Drizzle's is the ORM library itself, the totals measure different spans of the database-access stack; the counts are most useful read as maintenance surface of each project's own code.",
    ],
    caution:
      "Repository size does not indicate query speed or developer ergonomics: query execution happens against the database, and the developer experience lives in the API surface, neither of which is measured by source lines.",
    sources: [
      { label: "prisma/orm repository structure (client and engine monorepo)", url: "https://github.com/prisma/orm" },
      { label: "drizzle-team/drizzle-orm repository", url: "https://github.com/drizzle-team/drizzle-orm" },
    ],
    verifiedAt: "2026-10-16",
  },
  "biome-vs-prettier": {
    scope:
      "Repository layout before counting filters: biomejs/biome is the Biome repository: an all-in-one toolchain whose formatter and linter live in a single Rust codebase. prettier/prettier is the Prettier repository: the standalone code formatter written in JavaScript. The comparison is a multi-tool repository against a single-purpose formatter, and both repositories were taken on the dates in the methodology line.",
    insights: [
      "The language tables identify each project's implementation language at a glance: Biome's counted code is predominantly Rust, while Prettier's is JavaScript — different systems languages for tools that overlap in the formatting role.",
      "Biome's repository covers both formatting and linting, so part of its count exists for linter functionality that has no counterpart in the Prettier repository, which is formatter-only.",
    ],
    caution:
      "Repository size does not measure formatting speed or result quality; both properties depend on the shipped tool version and the languages being formatted, not on the source tree's line count.",
    sources: [
      { label: "biomejs/biome repository", url: "https://github.com/biomejs/biome" },
      { label: "prettier/prettier repository", url: "https://github.com/prettier/prettier" },
    ],
    verifiedAt: "2026-09-16",
  },
  "axios-vs-got": {
    scope:
      "Repository layout before counting filters: axios/axios is the Axios repository: a promise-based HTTP client that runs in both browsers and Node.js, with its type definitions, tests, and examples. sindresorhus/got is the Got repository: an HTTP client that targets Node.js specifically, with its own tests and documentation. The two are comparable as single-library source trees, counted on the dates in the methodology line above.",
    insights: [
      "The per-language tables show both repositories written in JavaScript with TypeScript definition files, so the counted difference is scope rather than implementation language: Axios maintains one client codebase across browser and Node.js environments, while Got targets Node.js only.",
    ],
    caution:
      "Line count does not track bundle weight, request throughput, or feature coverage; a smaller repository is not a lighter or faster HTTP client for any given workload.",
    sources: [
      { label: "axios/axios repository", url: "https://github.com/axios/axios" },
      { label: "sindresorhus/got repository", url: "https://github.com/sindresorhus/got" },
    ],
    verifiedAt: "2026-09-16",
  },
  "moment-vs-dayjs": {
    scope:
      "Repository layout before counting filters: moment/moment is the Moment.js repository — the date library, its large bundled locale data, plugins, tests, and documentation. iamkun/dayjs is the Day.js repository — the core date library with its plugin set, locales, and tests. Both repositories are date-library source trees, but Moment's tree includes a much larger share of shipped locale and formatting data, as the per-language tables of the two reports show.",
    insights: [
      "A large part of Moment's counted tree is locale data and the files that ship with the published package rather than core parsing logic — visible in its per-language table — so its total measures a library-plus-its-data, not just code.",
      "Day.js's counted tree is organized around a minimal core plus optional plugins that users enable individually, so its total measures a deliberately split codebase; the two totals therefore describe different packaging strategies for the same category of library.",
    ],
    caution:
      "Repository size here mostly reflects how much each project ships with — locales, plugins, and packaging — not runtime speed or API quality. Read the totals as a measure of shipped source, not of which date library suits a project.",
    sources: [
      { label: "moment/moment repository (with bundled locales)", url: "https://github.com/moment/moment" },
      { label: "iamkun/dayjs repository", url: "https://github.com/iamkun/dayjs" },
    ],
    verifiedAt: "2026-09-16",
  },
  "chartjs-vs-d3": {
    scope:
      "Repository layout before counting filters: chartjs/Chart.js is the Chart.js repository: a single canvas-based charting library with its test suite, samples, and documentation. d3/d3 is the D3 repository, which distributes the D3 modules (d3-array, d3-scale, d3-shape, and roughly thirty interdependent packages) as one tree. The comparison is one self-contained charting library versus a modular visualization toolkit, counted on the dates in the methodology line.",
    insights: [
      "The repository boundaries themselves are the main story: Chart.js keeps one library in one tree, while D3's tree aggregates dozens of small modules that are also published individually, so the right total is shaped by packaging decisions as much as by code volume.",
      "The two projects operate at different abstraction layers — Chart.js renders ready-made chart types to a canvas element, while D3 provides primitives for binding data to documents — which the numbers alone cannot show but which matters when reading them side by side.",
    ],
    caution:
      "A larger toolkit count does not mean more charts out of the box: D3 is lower-level building blocks, Chart.js is higher-level renderers. Neither number measures rendering quality, flexibility, or suitability for a given visualization.",
    sources: [
      { label: "chartjs/Chart.js repository", url: "https://github.com/chartjs/Chart.js" },
      { label: "d3/d3 repository (D3 modules monorepo)", url: "https://github.com/d3/d3" },
    ],
    verifiedAt: "2026-09-16",
  },
  "threejs-vs-babylonjs": {
    scope:
      "Repository layout before counting filters: mrdoob/three.js is the Three.js repository: the rendering library, its examples and documentation pages, and utilities in one tree — the project deliberately keeps the core small. BabylonJS/Babylon.js is the Babylon.js monorepo: the engine packages, loaders, materials, tooling, and their tests. Both are browser 3D rendering libraries, but the repositories are organized differently, which the contains and language tables above reflect.",
    insights: [
      "The per-language tables show Three.js's counted code as predominantly JavaScript while Babylon.js's is predominantly TypeScript — a direct consequence of each project's chosen implementation language for the rendering core.",
    ],
    caution:
      "Neither total measures rendering performance, feature coverage, or what an application loads at runtime: an app bundles only the parts of a library it imports, and both libraries ship modular entry points. Use these counts to sense each repository's size and structure, not to rank the libraries.",
    sources: [
      { label: "mrdoob/three.js repository (library plus examples/)", url: "https://github.com/mrdoob/three.js" },
      { label: "BabylonJS/Babylon.js repository (packages monorepo)", url: "https://github.com/BabylonJS/Babylon.js" },
    ],
    verifiedAt: "2026-09-16",
  },
  "express-vs-koa": {
    scope:
      "Repository layout before counting filters: expressjs/express is the Express repository: the Node.js web framework — its router, middleware layer, tests, and examples. koajs/koa is the Koa repository: the Node.js web framework built around async middleware composition, with its own tests and docs. Both are JavaScript framework source trees in the same ecosystem, counted with the rules shown above.",
    insights: [
      "Each repository is a framework core rather than a complete application stack: routing and middleware composition live here, while templating, databases, and most real-world functionality are external packages not counted on either side.",
    ],
    caution:
      "A smaller or larger framework core does not translate into fewer or more dependencies in a real application: production stacks add middleware and libraries on top of either framework, and these counts say nothing about request-handling performance.",
    sources: [
      { label: "expressjs/express repository (Node.js web framework)", url: "https://github.com/expressjs/express" },
      { label: "koajs/koa repository (async middleware web framework)", url: "https://github.com/koajs/koa" },
    ],
    verifiedAt: "2026-09-16",
  },
  "styled-components-vs-emotion": {
    scope:
      "Repository layout before counting filters: styled-components/styled-components is the styled-components repository: the CSS-in-JS library, its React bindings, tooling, and tests. emotion-js/emotion is the Emotion repository — a monorepo of CSS-in-JS packages, their tooling, and tests. Both are library-scoped TypeScript/JavaScript trees of similar purpose, measured under the rules and on the dates in the methodology line.",
    insights: [
      "The per-language tables of both reports are dominated by TypeScript and JavaScript with only small tooling shares, so for both libraries the totals sit close to the actual library source — few unrelated languages inflate either count.",
    ],
    caution:
      "Library repository size is not bundle size: bundlers include only the entry points an application imports, so these totals overstate what a given app would ship and cannot be compared as delivered-weight numbers.",
    sources: [
      { label: "styled-components/styled-components repository", url: "https://github.com/styled-components/styled-components" },
      { label: "emotion-js/emotion repository (CSS-in-JS monorepo)", url: "https://github.com/emotion-js/emotion" },
    ],
    verifiedAt: "2026-09-16",
  },
  "flask-vs-django": {
    scope:
      "Repository layout before counting filters: pallets/flask is the Flask core repository — the Python microframework itself, deliberately small, with extensions and documentation largely maintained in separate repositories under the same organization. django/django is the Django repository: the full-stack web framework with its ORM, admin, forms, templating, and contrib modules all in one tree. The comparison is minimal-core vs batteries-included monorepo, so the contains differ in what they include by design.",
    insights: [
      "Both repositories are Python codebases, as the per-language tables confirm; the size gap between them is structural — Django ships its ORM, admin interface, and contrib modules in the counted tree, while Flask's core keeps comparable functionality in external packages that are not counted.",
      "Reading Flask's count against Django's as if both covered the same scope understates the Flask ecosystem: a substantial amount of Flask-adjacent library code exists in repositories that are not part of either counted archive.",
    ],
    caution:
      "A smaller core does not mean a smaller finished application: the application code plus the extensions it pulls in determine the real total, so these counts compare framework cores, not application stacks.",
    sources: [
      { label: "pallets/flask repository", url: "https://github.com/pallets/flask" },
      { label: "django/django repository (full-stack framework incl. contrib)", url: "https://github.com/django/django" },
    ],
    verifiedAt: "2026-09-16",
  },
  "fastapi-vs-flask": {
    scope:
      "Repository layout before counting filters: fastapi/fastapi is the FastAPI repository: the web framework's Python source, documentation, and examples, built on top of the Starlette toolkit and Pydantic. pallets/flask is the Flask repository: a deliberately minimal Python web framework with its documentation and tests. Both repositories are framework source trees, taken on the dates shown in the methodology line.",
    insights: [
      "Both repositories are Python codebases, so the per-language tables are dominated by Python on both sides; the more interesting reading on this page is the totals relative to each project's stated scope.",
      "FastAPI builds on external libraries (Starlette for the HTTP layer, Pydantic for data validation) that are not part of its repository, while Flask keeps more of its core in-tree — so neither count includes everything each framework relies on at runtime.",
    ],
    caution:
      "FastAPI's dependence on Starlette and Pydantic means its repository total understates the code involved in serving a FastAPI app; comparing the two totals is not comparing like-for-like stacks.",
    sources: [
      { label: "fastapi/fastapi repository", url: "https://github.com/fastapi/fastapi" },
      { label: "pallets/flask repository", url: "https://github.com/pallets/flask" },
    ],
    verifiedAt: "2026-09-16",
  },
  "pandas-vs-polars": {
    scope:
      "Repository layout before counting filters: pandas-dev/pandas is the pandas repository: the Python DataFrame library, its Cython/C extension sources, tests, and documentation. pola-rs/polars is the Polars repository: the Rust core of the DataFrame engine plus its language bindings, including the Python bindings most users install. Both repositories were taken on the dates shown in the methodology line above.",
    insights: [
      "The per-language tables tell the implementation split directly: pandas is a predominantly Python codebase with Cython/C extension code beneath it, while Polars's counted code is dominated by Rust, with Python mainly present in the bindings layer.",
      "The Polars repository bundles bindings for several languages alongside the Rust core, so not every counted line belongs to the engine a given user imports — the per-language table helps separate core from bindings.",
    ],
    caution:
      "These counts do not measure query speed, memory use, or which library fits a workload; performance is a property of the shipped binaries and the query being run, not of the source trees' line counts.",
    sources: [
      { label: "pandas-dev/pandas repository", url: "https://github.com/pandas-dev/pandas" },
      { label: "pola-rs/polars repository (Rust core with language bindings)", url: "https://github.com/pola-rs/polars" },
    ],
    verifiedAt: "2026-09-16",
  },
  "numpy-vs-scipy": {
    scope:
      "Repository layout before counting filters: numpy/numpy is the NumPy repository — the ndarray implementation, its Python and C layers, tests, and documentation. scipy/scipy is the SciPy repository — a library of scientific computing modules (optimization, integration, signal processing, and others) built on top of the array model NumPy provides. Both are scientific-Python library trees, counted on the dates in the methodology line.",
    insights: [
      "The per-language tables of both reports show the two-layer implementation typical of scientific Python: Python as the dominant counted language with C underneath for the numerically hot paths of each library.",
      "SciPy's tree spans many distinct submodules — one per problem domain — while NumPy's tree is organized around a single core array object and its operations, so the totals reflect breadth of scope versus depth of one abstraction.",
    ],
    caution:
      "Line counts do not measure numerical performance or accuracy: those depend on the shipped release, the underlying compiled routines, and how a workload uses them — not on the size of either source tree.",
    sources: [
      { label: "numpy/numpy repository", url: "https://github.com/numpy/numpy" },
      { label: "scipy/scipy repository", url: "https://github.com/scipy/scipy" },
    ],
    verifiedAt: "2026-09-16",
  },
  "celery-vs-rq": {
    scope:
      "Repository layout before counting filters: celery/celery is the Celery repository: a distributed task queue for Python, with its core worker and result backends, a broad set of integration tests, and extensive documentation sources. rq/rq contains RQ (Redis Queue): a Python library that puts jobs in Redis and runs workers against them. Both are Python background-job libraries, counted on the dates shown above.",
    insights: [
      "Both trees are predominantly Python as the per-language tables show, so the difference in totals is about scope, not implementation language: Celery's count covers brokers, result backends, and scheduling features, while RQ deliberately centers on a Redis-backed worker.",
    ],
    caution:
      "The smaller RQ total should not be read as RQ being a lesser tool: it implements a deliberately narrower feature set. Task-queue choice depends on the features an application actually uses, not on the size of either source tree.",
    sources: [
      { label: "celery/celery repository", url: "https://github.com/celery/celery" },
      { label: "rq/rq repository", url: "https://github.com/rq/rq" },
    ],
    verifiedAt: "2026-09-16",
  },
  "black-vs-ruff": {
    scope:
      "Repository layout before counting filters: psf/black is the Black repository: the opinionated Python formatter, its test corpus, and documentation. astral-sh/ruff is the Ruff repository: a Python linter and formatter written in Rust, maintained as a workspace of crates. Both repositories are small relative to the frameworks on this site, and their measurements were taken on the dates shown above; the comparison is a single-purpose formatter against a multi-tool repository.",
    insights: [
      "Ruff's repository covers linting and formatting in one workspace, while Black's repository covers formatting alone, so the totals describe tools of different scope rather than two implementations of exactly the same job.",
    ],
    caution:
      "These counts cannot settle speed or compatibility questions — Ruff's formatter targets Black-compatible output, and performance depends on the installed versions and the rules configured. The numbers describe source-tree size only.",
    sources: [
      { label: "psf/black repository", url: "https://github.com/psf/black" },
      { label: "astral-sh/ruff repository (Rust workspace)", url: "https://github.com/astral-sh/ruff" },
    ],
    verifiedAt: "2026-09-16",
  },
  "mypy-vs-pyright": {
    scope:
      "Repository layout before counting filters: python/mypy is the mypy repository: the static type checker for Python, implemented in Python (with compiled components via mypyc), plus its extensive test and conformance suites. microsoft/pyright is the Pyright repository: a static type checker for Python implemented in TypeScript/JavaScript, packaged as both a CLI and a language server, with its own test suites. Both check the same language from different implementation stacks, counted on the dates above.",
    insights: [
      "The per-language tables capture the well-known implementation split: mypy's counted tree is predominantly Python, while Pyright's is predominantly TypeScript — two different languages used to build tools that analyze the same one.",
    ],
    caution:
      "Implementation language and repository size do not determine checking speed, memory use, or diagnostic quality; those depend on the shipped tool and how it is run (CLI, daemon, or language server), none of which is measured by these counts.",
    sources: [
      { label: "python/mypy repository (Python-implemented type checker)", url: "https://github.com/python/mypy" },
      { label: "microsoft/pyright repository (TypeScript-implemented type checker)", url: "https://github.com/microsoft/pyright" },
    ],
    verifiedAt: "2026-09-16",
  },
  "requests-vs-httpx": {
    scope:
      "Repository layout before counting filters: psf/requests is the Requests repository: the Python HTTP client library, its documentation, and tests. encode/httpx is the HTTPX repository — a Python HTTP client library with both synchronous and asynchronous APIs, plus its docs and tests. Both are single-purpose client-library trees in the Python ecosystem, counted on the dates shown above; HTTPX's lower-level transport dependency lives in a separate repository and is not part of either count.",
    insights: [
    ],
    caution:
      "Line count does not map to API coverage: differences between the libraries (for example sync- and async-style usage) are design properties that a source count cannot express, so read the totals as size, not capability.",
    sources: [
      { label: "psf/requests repository", url: "https://github.com/psf/requests" },
      { label: "encode/httpx repository", url: "https://github.com/encode/httpx" },
    ],
    verifiedAt: "2026-09-16",
  },
  "uv-vs-poetry": {
    scope:
      "Repository layout before counting filters: astral-sh/uv is the uv repository — the Rust-based Python package installer and resolver and the surrounding tooling in the same project — while python-poetry/poetry is the Poetry repository, the Python-based packaging and dependency-management tool with its own installer and resolver. Both repositories cover the tool itself rather than any environment it manages, taken on the dates in the methodology line above.",
    insights: [
      "The per-language tables make the headline contrast measurable: uv is a predominantly Rust codebase while Poetry is a Python application — two implementations of the same category of tool in different languages, without needing to infer anything from totals.",
    ],
    caution:
      "A larger or smaller source tree does not measure install or resolution speed: performance is a property of the shipped tool's design and the package set being resolved, not of the repository's line count.",
    sources: [
      { label: "astral-sh/uv repository (Rust Python tooling)", url: "https://github.com/astral-sh/uv" },
      { label: "python-poetry/poetry repository", url: "https://github.com/python-poetry/poetry" },
    ],
    verifiedAt: "2026-09-16",
  },
  "axum-vs-actix-web": {
    scope:
      "Repository layout before counting filters: tokio-rs/axum is the Axum repository: an ergonomic web framework built on the Tokio ecosystem's tower and hyper components. actix/actix-web is the Actix Web repository: a web framework with its own actor-model runtime layer underneath. Both are Rust web-framework source trees, measured under the rules and on the dates in the methodology line.",
    insights: [
      "Both repositories are written in Rust, and the per-language tables reflect that on both sides; on this page the totals are the more informative number, since the language mix offers little contrast.",
      "Axum's repository is comparatively thin over the shared Tokio ecosystem crates (which live in their own repositories), while Actix Web's repository carries its runtime layer in-tree — a structural difference visible only when the repositories are read, not from the counts alone.",
    ],
    caution:
      "Neither number measures request throughput or latency for a real service; both frameworks sit on top of asynchronous runtimes whose behavior depends on workload, configuration, and the ecosystem crates each application pulls in.",
    sources: [
      { label: "tokio-rs/axum repository", url: "https://github.com/tokio-rs/axum" },
      { label: "actix/actix-web repository", url: "https://github.com/actix/actix-web" },
    ],
    verifiedAt: "2026-09-16",
  },
  "rocket-vs-axum": {
    scope:
      "Repository layout before counting filters: rwf2/Rocket is the Rocket repository: a Rust web framework with its core, its procedural-macro codegen, documentation, and examples. tokio-rs/axum is the Axum repository: a Rust web framework maintained by the Tokio team, built to compose with the Tower service ecosystem, with its own modules, examples, and tests. Both are framework source trees within the Rust async ecosystem, counted on the dates above.",
    insights: [
      "Both repositories are written in Rust, as the per-language tables confirm, so the counted difference is in structure rather than language: Rocket's tree centers on a batteries-included framework with its own codegen macros, while Axum's tree concentrates on routing and handlers composed from the shared Tower/Hyper layers.",
    ],
    caution:
      "A framework repository's size does not indicate request throughput, latency, or suitability for an application; those depend on the versioned crate and how it is used, not on the source tree's line count.",
    sources: [
      { label: "rwf2/Rocket repository", url: "https://github.com/rwf2/Rocket" },
      { label: "tokio-rs/axum repository", url: "https://github.com/tokio-rs/axum" },
    ],
    verifiedAt: "2026-10-17",
  },
  "tokio-vs-async-std": {
    scope:
      "Repository layout before counting filters: tokio-rs/tokio is the Tokio workspace — the asynchronous runtime crates, their utilities, and the surrounding test and CI infrastructure, in Rust. async-rs/async-std is the async-std repository — a Rust library exposing asynchronous versions of the standard library's API, with its own tests and documentation. Both repositories are Rust async-runtime source trees, counted on the dates shown above.",
    insights: [
      "Both counted trees are predominantly Rust, as each per-language table shows, so the totals measure two codebases of the same kind — asynchronous runtimes for the same language and ecosystem.",
      "Tokio's repository is organized as a workspace of multiple published crates, while async-std's is organized around a single library surface modeled on the standard library — a structural difference the file layout of each repository makes visible.",
    ],
    caution:
      "Neither number speaks to runtime throughput or latency for a specific workload: async runtime performance depends on scheduler configuration, I/O patterns, and the application built on top, not on repository line counts.",
    sources: [
      { label: "tokio-rs/tokio repository (workspace of runtime crates)", url: "https://github.com/tokio-rs/tokio" },
      { label: "async-rs/async-std repository", url: "https://github.com/async-rs/async-std" },
    ],
    verifiedAt: "2026-09-16",
  },
  "yew-vs-leptos": {
    scope:
      "Repository layout before counting filters: yewstack/yew contains Yew: a Rust framework for writing web frontends that compile to WebAssembly, with its core, examples, and website content. leptos-rs/leptos contains Leptos: a newer Rust web framework built around fine-grained reactivity, also compiling to WebAssembly and additionally supporting server-side rendering. Both are Rust frontend-framework source trees, counted on the dates in the methodology line.",
    insights: [
      "Both counted trees are predominantly Rust as the per-language tables show, so the totals can be compared as two implementations of the same general idea — a Rust-authored frontend — rather than as different layers of a stack.",
      "Leptos's counted tree includes its server-side rendering and meta/framework support code alongside the client framework, while Yew's centers on the in-browser WASM framework, so part of the total difference reflects how much of the full stack each repository keeps in one tree.",
    ],
    caution:
      "These counts are framework source, not what ships to a browser: a compiled WASM bundle contains a subset of this code plus the application itself, and neither total measures runtime performance or bundle weight.",
    sources: [
      { label: "yewstack/yew repository", url: "https://github.com/yewstack/yew" },
      { label: "leptos-rs/leptos repository", url: "https://github.com/leptos-rs/leptos" },
    ],
    verifiedAt: "2026-09-16",
  },
  "ripgrep-vs-fd": {
    scope:
      "Repository layout before counting filters: BurntSushi/ripgrep is the ripgrep repository: the line-oriented search tool written in Rust, with its supporting crates for regex handling and its test corpora. sharkdp/fd is the fd repository: the file-finding tool, also written in Rust. Both are single-purpose command-line tools, making this one of the cleaner like-for-like comparisons on the site, counted on the dates in the methodology line.",
    insights: [
      "Both codebases are Rust-dominant in the per-language tables, so the difference in totals reflects what each tool takes on rather than how it is written: ripgrep carries its own search and regex machinery in-tree, while fd builds on shared crate dependencies for directory traversal and ignore-file handling.",
    ],
    caution:
      "The totals do not measure search speed or memory use in your working directory; those depend on the query, the file set, and the installed versions. A smaller or larger repository here says nothing about which finds files faster.",
    sources: [
      { label: "BurntSushi/ripgrep repository", url: "https://github.com/BurntSushi/ripgrep" },
      { label: "sharkdp/fd repository", url: "https://github.com/sharkdp/fd" },
    ],
    verifiedAt: "2026-09-16",
  },
  "gin-vs-echo": {
    scope:
      "Repository layout before counting filters: gin-gonic/gin is the Gin repository: the Go web framework, its router and middleware stack, tests, and examples. labstack/echo is the Echo repository: the Go web framework with its server, middleware, and test suites. Both are single-language Go framework trees — among the more directly comparable pairs in this registry — counted with the rules shown above.",
    insights: [
      "The per-language tables on both pages are essentially pure Go, so unlike most pairs on this site there is no language-mix asymmetry to account for when reading the totals.",
    ],
    caution:
      "Framework source size does not predict request throughput, latency, or memory use for your handlers — those depend on routing and middleware design and on application code, none of which is measured here.",
    sources: [
      { label: "gin-gonic/gin repository", url: "https://github.com/gin-gonic/gin" },
      { label: "labstack/echo repository", url: "https://github.com/labstack/echo" },
    ],
    verifiedAt: "2026-09-16",
  },
  "fiber-vs-gin": {
    scope:
      "Repository layout before counting filters: gofiber/fiber is the Fiber repository: a Go web framework built on the fasthttp HTTP engine (a separate dependency, not part of this count), with in-tree middleware and tests. gin-gonic/gin is the Gin repository — a Go web framework built on Go's standard net/http facilities, also with in-tree middleware and tests. Both are Go web-framework cores of the same kind, counted on the dates in the methodology line.",
    insights: [
      "Each per-language table is essentially one row of Go: both frameworks are implemented in their entirety in Go, so this comparison reads as two same-language, same-purpose trees measured side by side.",
      "Both repositories include their middleware collections in the core repo rather than in separate ones, so each total reflects the framework plus the commonly shipped middleware surface, not the routing core alone.",
    ],
    caution:
      "Framework source size says nothing about request throughput or latency: Fiber's and Gin's runtime behavior is shaped by the HTTP engine underneath them (fasthttp versus the standard library), and neither engine's code appears in these counts.",
    sources: [
      { label: "gofiber/fiber repository", url: "https://github.com/gofiber/fiber" },
      { label: "gin-gonic/gin repository", url: "https://github.com/gin-gonic/gin" },
    ],
    verifiedAt: "2026-09-16",
  },
  "zap-vs-logrus": {
    scope:
      "Repository layout before counting filters: uber-go/zap is the Zap repository — Uber's structured logging library for Go — while sirupsen/logrus is the Logrus repository, the older Go logging library whose API many other Go packages adopted. Both are single-purpose Go libraries rather than frameworks, counted with the rules shown above, making this one of the more like-for-like comparisons on this site.",
    insights: [
      "Both repositories are Go codebases, as the per-language tables show; the comparison on the page is between two implementations of the same library role rather than across languages or architectures.",
    ],
    caution:
      "Library size does not measure logging performance or suitability: allocation behavior, API shape, and maintenance status are properties not visible in source-line counts. Logrus is widely known to be in maintenance mode, which no line count will show.",
    sources: [
      { label: "uber-go/zap repository (structured logging library)", url: "https://github.com/uber-go/zap" },
      { label: "sirupsen/logrus repository", url: "https://github.com/sirupsen/logrus" },
    ],
    verifiedAt: "2026-09-16",
  },
  "cobra-vs-urfave-cli": {
    scope:
      "Repository layout before counting filters: spf13/cobra is the Cobra repository: a library for building command-line applications in Go, including its generators and documentation. urfave/cli is the urfave/cli repository: a Go library for the same purpose — defining commands, flags, and subcommands. Both are single-purpose Go libraries, making this a relatively like-for-like comparison, counted on the dates shown above.",
    insights: [
      "Both repositories are Go codebases, and the per-language tables show Go dominating both counts — two libraries in the same language addressing the same task of CLI construction.",
    ],
    caution:
      "Repository size does not indicate which library is more capable or more suitable; both expose similar command-and-flag abstractions, and the choice between them is a matter of API preference and existing ecosystem, not of line count.",
    sources: [
      { label: "spf13/cobra repository", url: "https://github.com/spf13/cobra" },
      { label: "urfave/cli repository", url: "https://github.com/urfave/cli" },
    ],
    verifiedAt: "2026-09-16",
  },
  "hugo-vs-jekyll": {
    scope:
      "Repository layout before counting filters: gohugoio/hugo is the Hugo repository: the Go static site generator — its build pipeline, template and content handling, and embedded assets for the tool itself. jekyll/jekyll is the Jekyll repository: the Ruby static site generator, its core, and its documentation and test suites. Both are generator source trees, not sites built with them, and both were counted on the dates in the methodology line above.",
    insights: [
      "The per-language tables show the implementation-language contrast plainly: Hugo's counted code is Go, while Jekyll's is Ruby — two generators addressing the same task in different language ecosystems.",
    ],
    caution:
      "Generator repository size says nothing about build speed, theme availability, or how large a generated site becomes; those depend on configuration, themes, and plugins, not on the tool's own line count.",
    sources: [
      { label: "gohugoio/hugo repository", url: "https://github.com/gohugoio/hugo" },
      { label: "jekyll/jekyll repository", url: "https://github.com/jekyll/jekyll" },
    ],
    verifiedAt: "2026-09-16",
  },
  "spring-boot-vs-quarkus": {
    scope:
      "Repository layout before counting filters: spring-projects/spring-boot is the Spring Boot repository — the convention-over-configuration framework layer on top of the Spring ecosystem, with its tests and documentation, in Java. quarkusio/quarkus is the Quarkus repository — the Kubernetes-oriented Java framework and its extension set, with its tests, in Java. Both repositories are JVM framework source trees, counted on the dates in the methodology line.",
    insights: [
      "The per-language tables show Java dominating both counted trees, which makes this a like-for-like comparison of two framework codebases written in the same language and aimed at overlapping server-side workloads.",
    ],
    caution:
      "Repository size does not indicate framework performance, startup time, or memory use: those are properties of a built application and its configuration, not of the framework source tree's line count.",
    sources: [
      { label: "spring-projects/spring-boot repository", url: "https://github.com/spring-projects/spring-boot" },
      { label: "quarkusio/quarkus repository", url: "https://github.com/quarkusio/quarkus" },
    ],
    verifiedAt: "2026-09-16",
  },
  "spring-boot-vs-micronaut": {
    scope:
      "Repository layout before counting filters: spring-projects/spring-boot is the Spring Boot repository: the auto-configuration layer, starters, actuator, and CLI that sit on top of the wider Spring Framework. micronaut-projects/micronaut-core contains Micronaut's core repository: the IoC container, HTTP server and client, and AOP machinery. Both are JVM framework source trees, counted on the dates shown above — but each is one repository inside a much larger multi-repository framework family.",
    insights: [
      "Both counted trees are predominantly Java as the per-language tables show, so the headline difference comes from repository scope: which subsystems each project keeps in its core tree versus in sibling repositories.",
      "Neither total represents its whole framework: Spring Boot builds on the Spring Framework repositories, and Micronaut splits its ecosystem across many micronaut-projects repositories — the pages count one tree per side, not the complete framework surface of either.",
    ],
    caution:
      "The smaller core-repository count should not be read as the smaller framework: both projects distribute most of their features across companion repositories that this comparison does not count, so the totals understate each ecosystem by a different, unmeasured amount.",
    sources: [
      { label: "spring-projects/spring-boot repository", url: "https://github.com/spring-projects/spring-boot" },
      { label: "micronaut-projects/micronaut-core repository", url: "https://github.com/micronaut-projects/micronaut-core" },
    ],
    verifiedAt: "2026-09-16",
  },
  "ktor-vs-spring-boot": {
    scope:
      "Repository layout before counting filters: ktorio/ktor is the Ktor repository: the Kotlin server and client framework, maintained as a multi-module build of plugins and engines. spring-projects/spring-boot is the Spring Boot repository: the auto-configuration machinery, starters, and actuator on top of the wider Spring ecosystem. Both repositories are server-side framework source trees, counted on the dates shown above.",
    insights: [
      "The per-language tables show the language split cleanly: Ktor's counted code is overwhelmingly Kotlin, while Spring Boot's is overwhelmingly Java — each framework's chosen implementation language.",
      "Both repositories are framework layers rather than finished servers: each ships configuration and integration machinery rather than an application, and Spring Boot additionally builds on the Spring Framework, which lives in a separate repository and is counted separately on this site.",
    ],
    caution:
      "Framework repository size does not indicate application memory footprint, startup time, or developer productivity; a running service includes the framework pieces it uses plus the application and its dependencies. Compare the counts as the reading surface of each framework's source.",
    sources: [
      { label: "ktorio/ktor repository (multi-module framework)", url: "https://github.com/ktorio/ktor" },
      { label: "spring-projects/spring-boot repository", url: "https://github.com/spring-projects/spring-boot" },
    ],
    verifiedAt: "2026-09-16",
  },
  "maven-vs-gradle": {
    scope:
      "Repository layout before counting filters: apache/maven is the Maven core repository — the build tool itself, written in Java; the plugin ecosystem largely lives in separate plugin repositories under the Apache Maven organization. gradle/gradle is the Gradle repository: the build system core together with a large set of built-in plugins and language support in one tree. The two repositories therefore include different amounts of each project's total surface, and their measurements were taken on the dates shown above.",
    insights: [
      "The per-language tables reflect each codebase's age and design: Maven core is overwhelmingly Java, while Gradle's tree mixes Java, Groovy, and Kotlin DSL code — the difference is visible as a language split rather than a single-language count.",
      "A structural asymmetry shapes the totals: functionality Maven keeps in separate plugin repositories is, for Gradle, committed inside the main repository, so part of the gap between counts is repository organization, not code volume alone.",
    ],
    caution:
      "Do not read these totals as a build-speed or flexibility comparison: the counts are shaped by what each project chooses to keep in one repository, and neither number measures how fast either tool builds your project.",
    sources: [
      { label: "apache/maven repository (build tool core)", url: "https://github.com/apache/maven" },
      { label: "gradle/gradle repository (core with built-in plugins)", url: "https://github.com/gradle/gradle" },
    ],
    verifiedAt: "2026-09-16",
  },
  "elasticsearch-vs-opensearch": {
    scope:
      "Repository layout before counting filters: elastic/elasticsearch is the Elasticsearch repository: the search and analytics engine, predominantly Java, with its modules, plugins (including the X-Pack sources), and test suites. opensearch-project/OpenSearch is the OpenSearch repository — a search and analytics engine, also predominantly Java, that forked from an earlier Elasticsearch release and has since developed independently. Both repositories therefore include engine, modules, and in-tree plugins, taken on the dates shown above.",
    insights: [
      "The per-language tables are dominated by Java on both sides — expected, since OpenSearch descends from the same codebase lineage and the two projects have continued in the same implementation language since the fork.",
      "Both repositories carry their plugin and module code inside the main tree, so a meaningful share of each count is extension surface — security, aggregation, and ingest modules — rather than the core engine alone.",
    ],
    caution:
      "The fork point matters when comparing: OpenSearch split from Elasticsearch at an earlier version, so equal-looking totals hide years of independent change in both directions. Treat the counts as two snapshots, not as a shared-codebase measurement, and check the count dates in the methodology line.",
    sources: [
      { label: "elastic/elasticsearch repository (engine, modules, and in-tree plugins)", url: "https://github.com/elastic/elasticsearch" },
      { label: "opensearch-project/OpenSearch repository", url: "https://github.com/opensearch-project/OpenSearch" },
    ],
    verifiedAt: "2026-09-16",
  },
  "rails-vs-sinatra": {
    scope:
      "Repository layout before counting filters: rails/rails is the Ruby on Rails monorepo — the framework's component gems (railties, Active Record, Action Pack, and the rest of the stack) developed together in one repository. sinatra/sinatra is the Sinatra repository: the small Ruby DSL for web applications, with most extensions and middleware living outside the counted tree. The comparison is full-stack monorepo vs minimal core, so the contains differ in scope by design.",
    insights: [
      "Both repositories are Ruby codebases, per the per-language tables; the size gap is structural, since Rails's counted tree includes its ORM, mailer, job, and routing layers while Sinatra's core intentionally omits them.",
      "Much of what a Rails application uses ships from the single counted repository, while comparable functionality for Sinatra lives in separate gems that are not part of either archive — the counts therefore cover unequal slices of each ecosystem.",
    ],
    caution:
      "These numbers do not say which framework suits a project: the choice turns on how much structure an application wants, not on how many lines the framework's repository contains.",
    sources: [
      { label: "rails/rails repository structure (framework monorepo)", url: "https://github.com/rails/rails" },
      { label: "sinatra/sinatra repository", url: "https://github.com/sinatra/sinatra" },
    ],
    verifiedAt: "2026-09-16",
  },
  "sidekiq-vs-resque": {
    scope:
      "Repository layout before counting filters: sidekiq/sidekiq is the Sidekiq repository: the Redis-backed background job processor for Ruby, its web UI, and its test suite. resque/resque is the Resque repository: also a Redis-backed background job library for Ruby, with its own worker and failure-handling code. Both are job-processor source trees in the same language, counted on the dates in the methodology line.",
    insights: [
      "Both repositories are Ruby codebases backed by Redis, and the per-language tables show Ruby dominating both counts — two projects in the same language and the same product category.",
      "Sidekiq's repository includes its web monitoring UI as part of the open-source repository, so part of its count exists for operational tooling that an application may or may not deploy.",
    ],
    caution:
      "The open-source Sidekiq repository does not contain every Sidekiq product — commercial editions are distributed separately — so this count covers the repository as published, not the full Sidekiq product line.",
    sources: [
      { label: "sidekiq/sidekiq repository", url: "https://github.com/sidekiq/sidekiq" },
      { label: "resque/resque repository", url: "https://github.com/resque/resque" },
    ],
    verifiedAt: "2026-09-16",
  },
  "laravel-vs-symfony": {
    scope:
      "Repository layout before counting filters: laravel/laravel is the Laravel application skeleton — the starter repository a new application is created from: default configuration, bootstrap files, and declared dependencies — not the framework implementation itself. symfony/symfony is the Symfony framework monorepo: component and bundle sources maintained together across many packages. These two repositories therefore do not describe the same kind of repository, which is the first thing to know when reading this page.",
    insights: [
      "The totals reflect that asymmetry directly: the Laravel skeleton is intentionally minimal, an empty starting point whose framework code arrives as a Composer dependency, while the Symfony monorepo counts the full framework source across dozens of components.",
      "The per-language tables confirm both projects live in the same language ecosystem, but one number measures a starter template and the other measures a maintained framework monorepo — this page is best read as an illustration of how repository selection shapes a count.",
    ],
    caution:
      "Do not conclude from this page that Laravel is a smaller or simpler framework: the framework code lives in laravel/framework, which is not what is counted here. This comparison measures repository selection, not framework size.",
    sources: [
      { label: "laravel/laravel repository (application skeleton)", url: "https://github.com/laravel/laravel" },
      { label: "symfony/symfony repository (framework monorepo)", url: "https://github.com/symfony/symfony" },
    ],
    verifiedAt: "2026-09-16",
  },
  "wordpress-vs-drupal": {
    scope:
      "Repository layout before counting filters: WordPress/WordPress is the WordPress core repository — the PHP application core with its bundled default themes, bundled JavaScript, and administration UI assets. drupal/drupal is the Drupal core repository — the PHP content-management framework with its core modules and bundled assets. Both repositories are PHP CMS core trees, counted on the dates shown above.",
    insights: [
      "The per-language tables of both reports show PHP as the dominant counted language, with a visible share of JavaScript for the administrative interfaces and bundled assets — typical of CMS codebases that ship their UI with the core.",
      "Both repositories ship end-user-facing material — default themes, assets, and localization scaffolding — alongside the PHP core, so part of each count is content and presentation rather than application logic.",
    ],
    caution:
      "Core repository size says nothing about what a real site runs: production WordPress and Drupal sites add themes, modules/plugins, and uploaded content that dwarf the core, and site quality depends on those additions, not on these counts.",
    sources: [
      { label: "WordPress/WordPress repository (core with bundled themes)", url: "https://github.com/WordPress/WordPress" },
      { label: "drupal/drupal repository", url: "https://github.com/drupal/drupal" },
    ],
    verifiedAt: "2026-09-16",
  },
  "cmake-vs-meson": {
    scope:
      "Repository layout before counting filters: Kitware/CMake is the CMake repository: the build-system generator implemented in C++, its module library, bundled utilities, and a very large Tests directory of sample projects used to verify behavior. mesonbuild/meson is the Meson repository: the build system implemented in Python, with its own test corpus of project skeletons. Both are build-tool source trees, counted on the dates in the methodology line.",
    insights: [
      "The per-language tables reflect each tool's implementation language directly — CMake is implemented in C++, Meson in Python — so the language share is a statement about how each tool is built, not about what it can generate.",
    ],
    caution:
      "Tool source-tree size is unrelated to build speed or generated-build quality for a given project; the counts describe the source remaining after the stated filters, not how either tool performs for its users.",
    sources: [
      { label: "Kitware/CMake repository", url: "https://github.com/Kitware/CMake" },
      { label: "mesonbuild/meson repository", url: "https://github.com/mesonbuild/meson" },
    ],
    verifiedAt: "2026-09-16",
  },
  "gcc-vs-llvm": {
    scope:
      "Repository layout before counting filters: gcc-mirror/gcc is a Git mirror of the GCC source repository: the compiler collection — front ends, optimizers, code generators, runtime libraries, and test suites across several languages. llvm/llvm-project is the LLVM monorepo: the LLVM core plus Clang, MLIR, LLDB, libc++, and other subprojects in one tree. Both are compiler-infrastructure source trees, but they are organized very differently, which the contains above reflect.",
    insights: [
      "Both trees are predominantly C and C++ in the per-language tables, befitting their shared role as native toolchains; the remaining share on each side marks the front ends and runtime libraries that are not written in the core languages.",
      "The totals are scoped differently by construction: llvm-project consolidates many subprojects into one counted tree, while the GCC mirror counts the GNU compiler collection proper, so the two numbers describe differently-scoped collections rather than two counts of 'one compiler'.",
    ],
    caution:
      "Compiler collection size does not measure compilation speed, generated-code quality, or which toolchain suits a project — those depend on the target, the languages involved, and the shipped toolchain versions. Read the counts as the size of two differently-organized source trees.",
    sources: [
      { label: "gcc-mirror/gcc repository (Git mirror of GCC)", url: "https://github.com/gcc-mirror/gcc" },
      { label: "llvm/llvm-project repository (monorepo of LLVM subprojects)", url: "https://github.com/llvm/llvm-project" },
    ],
    verifiedAt: "2026-09-16",
  },
  "nlohmann-json-vs-rapidjson": {
    scope:
      "Repository layout before counting filters: nlohmann/json is the nlohmann/json repository: a C++ JSON library best known for its single-header distribution, with the generating source, tests, documentation, and benchmarks in the same tree. Tencent/rapidjson is the RapidJSON repository: a multi-header C++ JSON library with its own test suite and benchmarks. Both are header-oriented C++ libraries, counted on the dates shown above.",
    insights: [
      "Both counted archives are overwhelmingly C++ in the per-language table, so this is a like-for-like language comparison; the totals differ mainly in how each project organizes and regenerates its headers.",
      "nlohmann/json's repository contains the amalgamation tooling that produces its single-header release artifact, while RapidJSON ships an include/ tree of separate headers — two different repo shapes for the same library category, both visible in the file layout of each report.",
    ],
    caution:
      "Header-library line counts do not track parsing speed, binary size, or compile-time cost in your build; benchmarks and your own measurements are the right tool for that, not these totals.",
    sources: [
      { label: "nlohmann/json repository (single-header C++ JSON library)", url: "https://github.com/nlohmann/json" },
      { label: "Tencent/rapidjson repository (multi-header C++ JSON library)", url: "https://github.com/Tencent/rapidjson" },
    ],
    verifiedAt: "2026-09-16",
  },
  "protobuf-vs-flatbuffers": {
    scope:
      "Repository layout before counting filters: protocolbuffers/protobuf is the Protocol Buffers repository: the schema compiler, plus runtime libraries for many programming languages. google/flatbuffers is the FlatBuffers repository — likewise a serialization project with a compiler and multi-language runtime libraries. Both repositories therefore span many language runtimes in a single tree, not one library, and their measurements were taken on the dates shown above.",
    insights: [
      "The per-language tables are the real story on this page: each repository is a multi-language project, with counted code spread across C++, Java, Python, Go, and other runtime directories, so the totals aggregate implementations for ecosystems a given user may never touch.",
      "Because both projects ship a compiler and language runtimes in one repo, a large share of each count is per-language support code — the same support matrix implemented twice, once per project — rather than serialization logic proper.",
    ],
    caution:
      "Do not read the totals as one-library-vs-one-library: each number is a bundle of many runtimes. If you use one language, the per-language breakdown above is the only part of the count that describes the code you would actually interact with.",
    sources: [
      { label: "protocolbuffers/protobuf repository (compiler and multi-language runtimes)", url: "https://github.com/protocolbuffers/protobuf" },
      { label: "google/flatbuffers repository (compiler and multi-language runtimes)", url: "https://github.com/google/flatbuffers" },
    ],
    verifiedAt: "2026-09-16",
  },
  "swift-vs-kotlin": {
    scope:
      "Repository layout before counting filters: swiftlang/swift is the Swift repository — the compiler, standard library, and toolchain for the Swift programming language. JetBrains/kotlin is the Kotlin repository — the compiler and core language infrastructure for Kotlin. Both are language-toolchain repositories rather than libraries or applications, counted with the rules shown above, which makes this one of the more like-for-like comparisons on this site.",
    insights: [
      "The per-language tables reflect each project's self-hosting trajectory: Swift's counted tree is a mix of C++ compiler code and an increasingly large Swift standard library, while Kotlin's counted tree is predominantly Kotlin with the runtime boundaries still maintained in other languages.",
    ],
    caution:
      "Language repository size does not measure language capability, compile speed, or runtime performance — those are properties of the shipped toolchain and the programs it compiles, not of the source tree's line count.",
    sources: [
      { label: "swiftlang/swift repository (compiler and standard library)", url: "https://github.com/swiftlang/swift" },
      { label: "JetBrains/kotlin repository (compiler and core infrastructure)", url: "https://github.com/JetBrains/kotlin" },
    ],
    verifiedAt: "2026-09-16",
  },
  "alamofire-vs-moya": {
    scope:
      "Repository layout before counting filters: Alamofire/Alamofire is the Alamofire repository: a Swift HTTP networking library with its request/response layer, serialization support, and documentation. Moya/Moya is the Moya repository: a network abstraction layer built on top of Alamofire, adding typed endpoints and provider abstractions. The two are stacked rather than substitutes, and both repositories were taken on the dates shown above.",
    insights: [
      "Both repositories are written in Swift, and the per-language tables reflect that on both sides; this page compares two Swift libraries in related layers of the same networking stack.",
      "Because Moya is built on Alamofire, an application using Moya also carries Alamofire's code at runtime; the two totals describe a dependency pair, not two independent choices.",
    ],
    caution:
      "This is not a competitor comparison in the usual sense: Moya's stated purpose is to wrap and abstract Alamofire, so choosing between them is choosing a layer of the stack, not two alternatives.",
    sources: [
      { label: "Alamofire/Alamofire repository", url: "https://github.com/Alamofire/Alamofire" },
      { label: "Moya/Moya repository", url: "https://github.com/Moya/Moya" },
    ],
    verifiedAt: "2026-09-16",
  },
  "vim-vs-neovim": {
    scope:
      "Repository layout before counting filters: vim/vim is the Vim repository: the C core, the large runtime directory of syntax, indent, and filetype scripts, documentation, and test directories. neovim/neovim is the Neovim repository: its C core (a fork of Vim), a Lua-based runtime, documentation, tests, and bundled third-party sources. Both repositories include far more than the editor core itself, and their measurements were taken on the dates shown above.",
    insights: [
      "The per-language tables show Neovim's Lua runtime alongside its C core, while Vim's counted code is C with its runtime scripts written in Vim's own script language — a reflection of each project's plugin and configuration story.",
    ],
    caution:
      "Editor repository size does not indicate features, startup time, or resource use; both projects ship runtime files that most users load selectively, so line count is a poor proxy for what an editor does.",
    sources: [
      { label: "vim/vim repository", url: "https://github.com/vim/vim" },
      { label: "neovim/neovim repository", url: "https://github.com/neovim/neovim" },
    ],
    verifiedAt: "2026-09-16",
  },
  "emacs-vs-vim": {
    scope:
      "Repository layout before counting filters: emacs-mirror/emacs is a GitHub mirror of the Emacs source tree: the C runtime core plus the large Emacs Lisp library — bundled modes, packages, and documentation — that makes up most of what users experience. vim/vim is the Vim repository: the C editor core with its Vimscript runtime files and documentation. Both repositories are text-editor source trees, but Emacs' tree carries a much larger Lisp library.",
    insights: [
      "A substantial share of Emacs' count is Lisp code that ships to users as the editor's bundled functionality — modes and libraries — so its total measures a core plus an ecosystem shipped in one tree.",
    ],
    caution:
      "The totals do not compare which editor does more: Emacs ships more of its extension library inside its own repository by design, while Vim's ecosystem lives largely in external plugins — a packaging difference the counts cannot bridge.",
    sources: [
      { label: "emacs-mirror/emacs (mirror of the Emacs source tree)", url: "https://github.com/emacs-mirror/emacs" },
      { label: "vim/vim repository", url: "https://github.com/vim/vim" },
    ],
    verifiedAt: "2026-09-16",
  },
  "alacritty-vs-kitty": {
    scope:
      "Repository layout before counting filters: alacritty/alacritty contains Alacritty: a GPU-accelerated terminal emulator written in Rust, including its core, platform frontends, and documentation. kovidgoyal/kitty contains kitty: a GPU-accelerated terminal also implementing its own graphics protocol, written in C with Python extensions (kittens), plus its tests and docs. Both are terminal-emulator source trees, counted on the dates shown above.",
    insights: [
      "The language tables carry the main structural fact: Alacritty's counted code is Rust while kitty's is C with a Python extension layer — two different implementation stacks for the same category of application.",
      "kitty's counted tree includes its graphics-protocol handling and the kittens extension subsystem, while Alacritty's deliberately stays minimal, so the total difference partly records how much functionality each project chooses to host in the core repository.",
    ],
    caution:
      "Terminal choice is not derivable from these numbers: rendering speed, latency, and feature set depend on the code that runs at render time and on configuration, not on the raw size of either source tree.",
    sources: [
      { label: "alacritty/alacritty repository", url: "https://github.com/alacritty/alacritty" },
      { label: "kovidgoyal/kitty repository", url: "https://github.com/kovidgoyal/kitty" },
    ],
    verifiedAt: "2026-09-16",
  },
  "nushell-vs-fish": {
    scope:
      "Repository layout before counting filters: nushell/nushell is the Nushell repository: the structured-data shell written in Rust — parser, evaluation engine, built-in commands, and their tests. fish-shell/fish-shell is the Fish repository: the user-friendly command-line shell with its own parser, builtins, and documentation; its core was ported from C++ to Rust for fish 4.0. Both repositories are shell source trees, counted on the dates shown in the methodology line.",
    insights: [
      "Nushell and fish 4 use Rust in their core implementations, but have different shell languages and interaction models. The selected tree and counting policy determine language totals; a shared implementation language does not make their scripting semantics interchangeable.",
      "Both repositories concentrate on the shell and its built-in commands. Inspect the pinned tree to distinguish those components from tests, documentation, and supporting scripts.",
    ],
    caution:
      "Repository size says nothing about startup time, memory use, or scripting capabilities — a shell's interactive feel depends on its features and versions, not on the line count of its source. The counts describe how much code maintains each shell.",
    sources: [
      { label: "nushell/nushell repository", url: "https://github.com/nushell/nushell" },
      { label: "fish 4.0 release notes (Rust port)", url: "https://fishshell.com/docs/4.0/relnotes.html" },
      { label: "fish-shell/fish-shell repository", url: "https://github.com/fish-shell/fish-shell" },
    ],
    verifiedAt: "2026-09-16",
  },
  "langchain-vs-llamaindex": {
    scope:
      "Repository layout before counting filters: langchain-ai/langchain is the LangChain monorepo: Python and JavaScript/TypeScript packages for the framework, plus documentation and cookbook examples. run-llama/llama_index is the LlamaIndex monorepo: the Python core, integration packages, and the TypeScript library in one tree. Both are integration-heavy LLM application frameworks, counted with the rules shown above.",
    insights: [
      "Both per-language tables are polyglot — Python alongside TypeScript on each side — because each project maintains parallel library code for the two ecosystems in a single repository.",
      "A large share of each tree is integration packages connecting to third-party model, vector-store, and data providers; that share grows with ecosystem breadth rather than with the size of either framework's core, so the totals substantially count connector surface.",
    ],
    caution:
      "Repository size here mostly tracks how many external providers each framework integrates with, not the power of its core abstractions — and neither total measures retrieval quality, latency, or cost for your application.",
    sources: [
      { label: "langchain-ai/langchain repository (Python and JS/TS monorepo)", url: "https://github.com/langchain-ai/langchain" },
      { label: "run-llama/llama_index repository (Python core and integrations)", url: "https://github.com/run-llama/llama_index" },
    ],
    verifiedAt: "2026-09-16",
  },
  "ollama-vs-llama-cpp": {
    scope:
      "Repository layout before counting filters: ollama/ollama is the Ollama repository: the Go application that packages and serves local language models, built on top of the llama.cpp inference engine (a separate repository, not part of this count). ggml-org/llama.cpp is the llama.cpp repository — the C/C++ inference engine, its build system, examples, and language bindings. The comparison is therefore an application-repository vs engine-repository: adjacent layers, counted on the dates above.",
    insights: [
      "The per-language tables show the layer split directly: Ollama's counted code is predominantly Go, while llama.cpp's counted code is C and C++ — an application written in one language on top of a native engine written in another.",
      "The llama.cpp tree includes example programs and bindings for many languages in the same repository, so a visible share of its count exists to demonstrate and expose the engine rather than to run inference itself.",
    ],
    caution:
      "These two projects are not rivals in the counted code: Ollama builds on llama.cpp, so part of what Ollama does at runtime is implemented in the repository counted on the right. Also, neither count includes model weights, which dominate any real deployment's disk footprint.",
    sources: [
      { label: "ollama/ollama repository (Go application for running local models)", url: "https://github.com/ollama/ollama" },
      { label: "ggml-org/llama.cpp repository (C/C++ inference engine)", url: "https://github.com/ggml-org/llama.cpp" },
    ],
    verifiedAt: "2026-09-16",
  },
  "vllm-vs-tgi": {
    scope:
      "Repository layout before counting filters: vllm-project/vllm is the vLLM repository — the Python-centric inference engine with its CUDA kernels, scheduling, and serving layers. huggingface/text-generation-inference is the TGI repository — a codebase split between a Rust router/launcher and a Python inference server with its own kernel code. Both repositories cover serving-side inference software, but the two repositories partition that software differently between languages and components.",
    insights: [
      "The per-language tables show the different shapes directly: vLLM's counted tree is dominated by Python with C++/CUDA kernel components, while TGI's counted tree carries a substantial Rust share for its router and launcher alongside the Python server — an architecture split visible in language mix without inferring anything from totals.",
      "Both repositories include kernel and continuous-integration material tied to specific GPU stacks, so part of each count exists to support hardware targets rather than to serve as portable library code.",
    ],
    caution:
      "Repository size does not measure serving throughput, latency, or hardware efficiency: those depend on the model, the kernels, batching configuration, and the GPU, none of which are represented by source-line counts.",
    sources: [
      { label: "vllm-project/vllm repository (inference and serving engine)", url: "https://github.com/vllm-project/vllm" },
      { label: "huggingface/text-generation-inference repository (router and inference server)", url: "https://github.com/huggingface/text-generation-inference" },
    ],
    verifiedAt: "2026-09-16",
  },
  "transformers-vs-diffusers": {
    scope:
      "Repository layout before counting filters: huggingface/transformers is the Transformers repository: model implementations and utilities for a wide range of machine-learning model architectures, predominantly Python. huggingface/diffusers is the Diffusers repository: pipeline and model components for diffusion models, also predominantly Python. Both are Hugging Face model libraries, counted on the dates in the methodology line.",
    insights: [
      "Both repositories are Python codebases, and the per-language tables show Python dominating both counts — two libraries from the same organization sharing an implementation language and a model-distribution role.",
      "Transformers covers a much broader range of model architectures, while Diffusers is scoped to diffusion models and their pipelines, so the two totals differ in scope of coverage as much as in scale.",
    ],
    caution:
      "Neither repository count includes the model weights these libraries load, which are stored and downloaded separately; the counts measure library code only, and say nothing about model size or capability.",
    sources: [
      { label: "huggingface/transformers repository", url: "https://github.com/huggingface/transformers" },
      { label: "huggingface/diffusers repository", url: "https://github.com/huggingface/diffusers" },
    ],
    verifiedAt: "2026-09-16",
  },
  "milvus-vs-qdrant": {
    scope:
      "Repository layout before counting filters: milvus-io/milvus is the Milvus repository: a distributed vector database — its Go serving and coordination layers, C++ compute components, and tests. qdrant/qdrant is the Qdrant repository: a vector database engine written predominantly in Rust, with its storage, indexing, and API layers. Both are database source trees, counted on the dates in the methodology line above.",
    insights: [
      "The per-language tables contrast the two codebases directly: Milvus's counted code spans Go and C++ as a distributed system with separate compute components, while Qdrant's is predominantly Rust in a single engine codebase.",
    ],
    caution:
      "These counts do not measure query latency, recall, scalability, or resource efficiency — those are properties of the deployed system and its workload, not of repository line counts.",
    sources: [
      { label: "milvus-io/milvus repository", url: "https://github.com/milvus-io/milvus" },
      { label: "qdrant/qdrant repository", url: "https://github.com/qdrant/qdrant" },
    ],
    verifiedAt: "2026-09-16",
  },
  "redis-vs-memcached": {
    scope:
      "Repository layout before counting filters: redis/redis is the Redis repository — the in-memory data structure server in C, including its bundled dependencies, tests, and utilities. memcached/memcached is the Memcached repository — the in-memory key-value cache daemon in C, a more focused single-purpose codebase. Both repositories are C server trees, but Redis's includes a broader feature surface and bundled third-party code.",
    insights: [
      "Redis' counted tree includes a deps directory of bundled third-party C libraries it builds against, which the per-language table reflects as additional C beyond the server code itself; Memcached's tree has no comparable bundled-dependency footprint.",
      "The scope difference is architectural: Redis implements multiple data structures and server features in one repository, while Memcached implements one focused caching protocol — so the totals measure different breadths of responsibility.",
    ],
    caution:
      "The larger tree does not say which is faster or more suitable as a cache: throughput and latency depend on the workload, the deployed version, and the client — not on how many lines each repository contains.",
    sources: [
      { label: "redis/redis repository", url: "https://github.com/redis/redis" },
      { label: "memcached/memcached repository", url: "https://github.com/memcached/memcached" },
    ],
    verifiedAt: "2026-09-16",
  },
  "mysql-vs-postgres": {
    scope:
      "Repository layout before counting filters: mysql/mysql-server is the MySQL server source tree: the SQL layer, storage engines including InnoDB, the mysql-test suite, and client programs. postgres/postgres is the PostgreSQL source tree: the backend, its extensible type and index machinery, regression tests, and documentation sources. Both are full relational-database server codebases, counted on the dates in the methodology line, which makes this one of the more like-for-like comparisons on the site.",
    insights: [
      "Both trees are predominantly C-family systems code — MySQL's counted code is largely C++ while PostgreSQL's is C — as the per-language tables show, reflecting two long-lived server codebases written in different eras' dominant systems languages.",
    ],
    caution:
      "Server source size does not measure query performance, feature completeness, or operational suitability for a workload; these counts describe maintenance surface and test infrastructure, not runtime behavior.",
    sources: [
      { label: "mysql/mysql-server repository", url: "https://github.com/mysql/mysql-server" },
      { label: "postgres/postgres repository", url: "https://github.com/postgres/postgres" },
    ],
    verifiedAt: "2026-09-16",
  },
  "kafka-vs-rabbitmq": {
    scope:
      "Repository layout before counting filters: apache/kafka is the Kafka repository: the broker, the Java client, Connect, Streams, and their tests, with the server written in a mix of Scala and Java. rabbitmq/rabbitmq-server is the RabbitMQ server repository: the broker written primarily in Erlang, plus its core plugins and test suites. Both are message-broker source trees, but implemented in different languages, as the per-language tables above show.",
    insights: [
      "The per-language tables make the implementation split legible at a glance: Kafka's counted code is predominantly Java and Scala, while RabbitMQ's is predominantly Erlang — each broker built on its language's concurrency model.",
      "Each repository counts the broker core, but the scoping differs slightly: Kafka's client libraries and Streams live in the same tree, while part of RabbitMQ's plugin ecosystem lives in separate repositories, so the totals are not framed identically on both sides.",
    ],
    caution:
      "Broker repository size does not measure throughput, latency, or operational footprint — those depend on configuration, workload, and cluster topology. Use these counts to compare the size and shape of the two source trees, not to choose a message broker.",
    sources: [
      { label: "apache/kafka repository (broker, clients, Connect, Streams)", url: "https://github.com/apache/kafka" },
      { label: "rabbitmq/rabbitmq-server repository (Erlang broker)", url: "https://github.com/rabbitmq/rabbitmq-server" },
    ],
    verifiedAt: "2026-09-16",
  },
  "clickhouse-vs-druid": {
    scope:
      "Repository layout before counting filters: ClickHouse/ClickHouse is the ClickHouse repository: the columnar database server, written predominantly in C++, including a contrib/ tree of vendored third-party libraries compiled into the server. apache/druid is the Druid repository: the distributed analytics datastore, written predominantly in Java, with dependencies pulled at build time rather than vendored in-tree. Both are full database server source trees, counted on the dates shown above.",
    insights: [
      "The per-language tables show the language split directly — C++-dominated on one side, Java-dominated on the other — matching each project's well-known implementation language.",
      "Dependency accounting differs by build tradition: ClickHouse's count includes its vendored contrib/ libraries, while Druid's count covers mostly its own code with external dependencies fetched by its build, so the totals include different amounts of third-party material.",
    ],
    caution:
      "Server repository size says nothing about query performance, compression, or resource use for a given workload; those are properties of the built system and your schema, not of the source tree's line count.",
    sources: [
      { label: "ClickHouse/ClickHouse repository (C++ columnar database server)", url: "https://github.com/ClickHouse/ClickHouse" },
      { label: "apache/druid repository (Java distributed datastore)", url: "https://github.com/apache/druid" },
    ],
    verifiedAt: "2026-09-16",
  },
  "cassandra-vs-scylla": {
    scope:
      "Repository layout before counting filters: apache/cassandra is the Cassandra repository: the wide-column database engine, predominantly Java, with its query language layer and extensive test suites. scylladb/scylladb is the ScyllaDB repository — a database written in C++ that implements the Cassandra query language and protocol family. The two databases share a protocol and query-language lineage but are independent implementations, counted on the dates shown above.",
    insights: [
      "The per-language tables state the architectural difference in one glance: Cassandra's counted code is predominantly Java, while ScyllaDB's counted code is C++ — different implementation languages for databases that speak the same query-language family.",
    ],
    caution:
      "Same query language does not mean same codebase or same behavior under load: these are independent implementations, and repository size is a property of each project's source tree — it does not measure throughput, latency, or operational characteristics.",
    sources: [
      { label: "apache/cassandra repository", url: "https://github.com/apache/cassandra" },
      { label: "scylladb/scylladb repository (C++ implementation)", url: "https://github.com/scylladb/scylladb" },
    ],
    verifiedAt: "2026-09-16",
  },
  "cockroachdb-vs-yugabyte": {
    scope:
      "Repository layout before counting filters: cockroachdb/cockroach is the CockroachDB repository — a distributed SQL database implemented as a single large Go codebase. yugabyte/yugabyte-db is the YugabyteDB repository — a distributed SQL database whose counted tree includes a substantial C++ storage and query layer, including code derived from PostgreSQL. Both repositories are distributed database source trees, but implemented in different languages with different inherited codebases.",
    insights: [
      "The per-language tables carry the headline contrast: CockroachDB's counted tree is predominantly Go, while YugabyteDB's counted tree is predominantly C++ — two implementations of the same database category in different systems languages, visible without any inference from totals.",
      "YugabyteDB's total includes PostgreSQL-derived query-layer code as part of its counted archive, while CockroachDB implements its SQL layer in its own tree, so the counts reflect different code provenance as well as different sizes.",
    ],
    caution:
      "Source-tree size does not measure database throughput, consistency behavior, or operational cost: those are properties of the running system and its deployment, not of how many lines the repository contains.",
    sources: [
      { label: "cockroachdb/cockroach repository (distributed SQL database)", url: "https://github.com/cockroachdb/cockroach" },
      { label: "yugabyte/yugabyte-db repository (distributed SQL database)", url: "https://github.com/yugabyte/yugabyte-db" },
    ],
    verifiedAt: "2026-09-16",
  },
  "docker-vs-podman": {
    scope:
      "Repository layout before counting filters: moby/moby is the Moby project repository — the upstream open-source components from which the Docker Engine is assembled — rather than the Docker CLI or Desktop products, which live in other repositories. podman-container-tools/podman is the Podman repository: the daemonless container engine and its accompanying tooling. Both are container-engine source trees written largely in Go, counted on the dates shown above.",
    insights: [
      "Both repositories are predominantly Go, and the per-language tables show that on both sides; this page compares two Go codebases in the same product category of container engines.",
      "Podman's repository includes additional command-line and companion components alongside the engine, while Moby's repository is the engine upstream from which Docker's commercial products are built — so each total is organized around a different release boundary.",
    ],
    caution:
      "The left count is Moby, Docker's upstream project, not the Docker product most users install; Docker Desktop and the Docker CLI ship from other repositories, so neither total here is a complete picture of either vendor's product surface.",
    sources: [
      { label: "moby/moby repository (upstream components of the Docker Engine)", url: "https://github.com/moby/moby" },
      { label: "podman-container-tools/podman repository", url: "https://github.com/podman-container-tools/podman" },
    ],
    verifiedAt: "2026-10-16",
  },
  "helm-vs-kustomize": {
    scope:
      "Repository layout before counting filters: helm/helm is the Helm repository: the Kubernetes package manager — its Go CLI, chart templating and release logic, and tests. kubernetes-sigs/kustomize is the Kustomize repository: the Kubernetes configuration customization tool, maintained under the Kubernetes special-interest-group organization, with its own modules and tests. Both are Go CLI tools in the Kubernetes ecosystem, counted on the dates shown above.",
    insights: [
      "Both repositories are written in Go, as the per-language tables show, and both center on CLI tooling that operates on Kubernetes configuration files — Helm by rendering versioned chart templates, Kustomize by layering patches over bases without templates.",
    ],
    caution:
      "Tool repository size says nothing about which approach fits a deployment or how a rendered configuration behaves; those depend on the charts and overlays a team maintains, not on the CLI's own line count.",
    sources: [
      { label: "helm/helm repository", url: "https://github.com/helm/helm" },
      { label: "kubernetes-sigs/kustomize repository", url: "https://github.com/kubernetes-sigs/kustomize" },
    ],
    verifiedAt: "2026-09-16",
  },
  "argo-cd-vs-flux": {
    scope:
      "Repository layout before counting filters: argoproj/argo-cd is the Argo CD repository — the declarative GitOps continuous-delivery tool for Kubernetes, written in Go with a web UI layer in TypeScript. fluxcd/flux2 is the Flux repository — the GitOps toolkit's CLI and controllers, written in Go. Both repositories are Kubernetes GitOps tool source trees, counted on the dates in the methodology line above.",
    insights: [
      "The per-language tables show Go dominating both trees, as expected for Kubernetes ecosystem tools whose controllers run against the Kubernetes API; Argo CD's table additionally carries a visible TypeScript share from its bundled web interface.",
      "Both repositories package their CLI and their cluster-side components in one tree, so each total measures a complete operator-style tool — client and controllers together — rather than a single binary.",
    ],
    caution:
      "Line counts do not measure GitOps correctness or which tool fits a delivery pipeline: that depends on each tool's declared configuration model, how a team structures environments, and operational practices — not on repository size.",
    sources: [
      { label: "argoproj/argo-cd repository", url: "https://github.com/argoproj/argo-cd" },
      { label: "fluxcd/flux2 repository", url: "https://github.com/fluxcd/flux2" },
    ],
    verifiedAt: "2026-09-16",
  },
  "nomad-vs-kubernetes": {
    scope:
      "Repository layout before counting filters: hashicorp/nomad contains Nomad: HashiCorp's cluster scheduler and workload orchestrator, implemented in Go as a single-binary server/agent system with its UI and tests. kubernetes/kubernetes is the Kubernetes core monorepo: API server, scheduler, kubelet, controllers, client libraries, generated code, and tests. Both are Go orchestration systems, but at markedly different repository scopes, counted on the dates shown above.",
    insights: [
      "Nomad's counted tree includes its web UI and agent code alongside the scheduler, while Kubernetes's tree aggregates components that are deployed and versioned together — different packaging philosophies are visible in the totals.",
    ],
    caution:
      "The much larger Kubernetes count should not be read as superiority or as Nomad being incomplete: the two systems make different scope and packaging trade-offs, and orchestrator choice depends on workload requirements, not repository size.",
    sources: [
      { label: "hashicorp/nomad repository", url: "https://github.com/hashicorp/nomad" },
      { label: "kubernetes/kubernetes repository (core monorepo)", url: "https://github.com/kubernetes/kubernetes" },
    ],
    verifiedAt: "2026-09-16",
  },
};
