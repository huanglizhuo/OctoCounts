#!/usr/bin/env node
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '../package.json');

const bump = process.argv[2];
if (!bump) {
  console.error('Usage: npm run release <patch|minor|major|x.y.z>');
  process.exit(1);
}

const run = (cmd) => execSync(cmd, { stdio: 'inherit', cwd: resolve(__dirname, '../..') });

execSync(`npm version ${bump} --no-git-tag-version`, { stdio: 'inherit', cwd: resolve(__dirname, '..') });

const { version } = JSON.parse(readFileSync(pkgPath, 'utf8'));
const tag = `extension-v${version}`;

run(`git add extension/package.json extension/package-lock.json`);
run(`git commit -m "update to ${tag}"`);
run(`git tag ${tag}`);
run(`git push origin HEAD`);
run(`git push origin ${tag}`);

console.log(`\nReleased ${tag} — GitHub Actions will build and publish the extension.`);
