#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = resolve(extensionDir, '..');
const packageDir = resolve(extensionDir, 'packages');
const targets = ['chrome', 'edge', 'firefox'];
const release = process.argv.includes('--release');
const dryRun = process.argv.includes('--dry-run');
const { version } = readJson(resolve(extensionDir, 'package.json'));
const shortSha = execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], {
  cwd: rootDir,
  encoding: 'utf8',
}).trim();

const builds = targets.map((target) => {
  const distDir = resolve(extensionDir, 'dist', target);
  const info = readJson(resolve(distDir, 'build-info.json'));
  const manifest = readJson(resolve(distDir, 'manifest.json'));
  assertBuild(target, distDir, info, manifest);
  return {
    target,
    distDir,
    archive: `octocounts-${target}-v${version}-${shortSha}.zip`,
    storeConfigured: info.storeConfigured,
  };
});

const edge = builds.find((build) => build.target === 'edge');
if (release && !edge.storeConfigured) {
  fail(
    'Edge release packaging is blocked: set EDGE_STORE_URL and EDGE_STORE_REVIEW_URL to the approved Microsoft Edge Add-ons URLs, rebuild, and retry.',
  );
}

if (dryRun) {
  console.log(builds.map(({ target, archive }) => `${target}: ${archive}`).join('\n'));
  process.exit(0);
}

mkdirSync(packageDir, { recursive: true });
for (const build of builds) {
  const archivePath = resolve(packageDir, build.archive);
  rmSync(archivePath, { force: true });
  execFileSync('zip', ['-qr', archivePath, '.'], { cwd: build.distDir, stdio: 'inherit' });
  console.log(`Packaged ${build.target}: packages/${build.archive}`);
}

writeFileSync(
  resolve(packageDir, 'artifacts.json'),
  `${JSON.stringify({ version, shortSha, artifacts: builds.map(({ target, archive }) => ({ target, archive })) }, null, 2)}\n`,
);

function assertBuild(target, distDir, info, manifest) {
  if (info.target !== target || info.store !== target) {
    fail(`Invalid ${target} build-info.json: target/store identity does not match the artifact.`);
  }
  if (info.version !== version || manifest.version !== version) {
    fail(`Invalid ${target} artifact: build-info and manifest versions must both equal ${version}.`);
  }

  const serialized = artifactText(distDir);
  const forbidden = targets.filter((candidate) => candidate !== target).map(storeHost);
  for (const host of forbidden) {
    if (serialized.includes(host)) {
      fail(`Invalid ${target} artifact: build info contains another store host (${host}).`);
    }
  }
}

function artifactText(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .map((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return artifactText(path);
      if (!/\.(?:html|js|json)$/.test(entry.name)) return '';
      return readFileSync(path, 'utf8');
    })
    .join('\n');
}

function storeHost(target) {
  if (target === 'chrome') return 'chromewebstore.google.com';
  if (target === 'edge') return 'microsoftedge.microsoft.com';
  return 'addons.mozilla.org';
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`Cannot package extension artifact: ${path}: ${error.message}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
