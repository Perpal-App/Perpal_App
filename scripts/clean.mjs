#!/usr/bin/env node
/**
 * Cache cleaner for the Pivote native build.
 *
 * Caches are layered. Clearing the wrong layer wastes time; clearing all of
 * them on every run wastes more. Levels, cheapest first:
 *
 *   (default)  JS layer   - Metro transform cache, Expo local state, node cache.
 *                           Use for stale bundles, phantom import errors,
 *                           "module not found" after moving files.
 *   --deep     + native   - Gradle and Xcode build output for this project.
 *                           Use after a native module, plugin or SDK change.
 *   --native   + regen    - Deletes ios/ and android/ entirely. You must run
 *                           `npx expo prebuild --clean` afterwards.
 *   --modules  + deps     - Deletes node_modules and reinstalls from the
 *                           lockfile. Last resort.
 *
 * Nothing outside this project is touched except Xcode DerivedData folders
 * belonging to this app, which are matched by prefix.
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const XCODE_PROJECT_PREFIX = 'Pivote-';

const args = new Set(process.argv.slice(2));

if (args.has('--help') || args.has('-h')) {
  console.log(
    [
      'Usage: node scripts/clean.mjs [--deep] [--native] [--modules]',
      '',
      '  (no flag)   Metro cache, .expo, node_modules/.cache',
      '  --deep      also Gradle + Xcode build output for this project',
      '  --native    also delete ios/ and android/ (prebuild required after)',
      '  --modules   also delete node_modules and reinstall from lockfile',
    ].join('\n'),
  );
  process.exit(0);
}

const deep = args.has('--deep') || args.has('--native');
const native = args.has('--native');
const modules = args.has('--modules');

let removed = 0;

/** Remove a path if it exists, and report it. */
function drop(path, label) {
  if (!existsSync(path)) return;
  rmSync(path, { recursive: true, force: true });
  removed += 1;
  console.log(`  removed  ${label ?? path}`);
}

/** Remove every entry in `dir` whose name starts with one of `prefixes`. */
function dropByPrefix(dir, prefixes) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (prefixes.some((p) => entry.startsWith(p))) {
      drop(join(dir, entry), join(dir, entry));
    }
  }
}

function run(command, cwd) {
  try {
    execSync(command, { cwd, stdio: 'inherit' });
  } catch {
    console.log(`  skipped  ${command} (non-zero exit)`);
  }
}

console.log('\nJS layer');
drop('.expo');
drop(join('node_modules', '.cache'));
dropByPrefix(tmpdir(), ['metro-', 'haste-map-', 'react-native-packager-cache-']);

if (deep) {
  console.log('\nNative build output');
  if (existsSync('android')) {
    run('./gradlew --stop', 'android');
    drop(join('android', '.gradle'));
    drop(join('android', 'build'));
    drop(join('android', 'app', 'build'));
  }
  if (existsSync('ios')) {
    drop(join('ios', 'build'));
    drop(join('ios', 'Pods'));
    drop(join('ios', 'Podfile.lock'));
  }
  dropByPrefix(join(homedir(), 'Library', 'Developer', 'Xcode', 'DerivedData'), [
    XCODE_PROJECT_PREFIX,
  ]);
}

if (native) {
  console.log('\nGenerated native projects');
  drop('ios');
  drop('android');
  console.log('  next     npx expo prebuild --clean');
}

if (modules) {
  console.log('\nDependencies');
  drop('node_modules');
  run('npm ci');
}

console.log(`\ndone (${removed} path${removed === 1 ? '' : 's'} removed)\n`);
