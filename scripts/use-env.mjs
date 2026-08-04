#!/usr/bin/env node
/**
 * Activates a build target by copying `.env.<target>` into `.env`.
 *
 * Expo only auto-loads `.env`, `.env.local`, and `.env.<mode>`, so an arbitrary
 * name like `.env.devnet` is never read on its own. Rather than teach every
 * command a custom loader, one explicit copy makes the active target obvious and
 * keeps `appConfig` reading plain `process.env`.
 *
 * The written file carries a header naming its source, so nobody edits `.env`
 * directly and loses the change on the next switch.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGETS = ['devnet', 'mainnet'];
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const target = process.argv[2];

if (!target || !TARGETS.includes(target)) {
  console.error(`Usage: node scripts/use-env.mjs <${TARGETS.join('|')}>`);
  process.exit(1);
}

const sourcePath = join(projectRoot, `.env.${target}`);
const destinationPath = join(projectRoot, '.env');

if (!existsSync(sourcePath)) {
  console.error(
    `Missing .env.${target}. Copy .env.example to .env.${target} and fill it in.`,
  );
  process.exit(1);
}

const header = [
  `# GENERATED FILE — do not edit.`,
  `# Copied from .env.${target} by \`npm run env:${target}\`.`,
  `# Edit .env.${target} instead; this file is overwritten on every switch.`,
  '',
].join('\n');

writeFileSync(destinationPath, `${header}${readFileSync(sourcePath, 'utf8')}`);

// Report the target without echoing values, so this is safe in shared terminals.
console.log(`Active build target: ${target}`);
console.log('Restart the dev server or rebuild for the change to take effect.');
