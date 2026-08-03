#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const MAX_LINES = 500;
const SOURCE_ROOTS = ['app', 'src', 'scripts'];
const ROOT_FILES = ['app.config.ts', 'eslint.config.js', 'index.ts'];
const SOURCE_EXTENSIONS = new Set(['.cjs', '.css', '.js', '.jsx', '.mjs', '.ts', '.tsx']);

async function collectSourceFiles(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(path, entry.name);

      if (entry.isDirectory()) {
        return collectSourceFiles(entryPath);
      }

      return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [entryPath] : [];
    }),
  );

  return nested.flat();
}

function countLines(source) {
  if (source.length === 0) return 0;
  return source.split(/\r?\n/u).length;
}

const nestedFiles = (await Promise.all(SOURCE_ROOTS.map(collectSourceFiles))).flat();
const sourceFiles = [...ROOT_FILES, ...nestedFiles].sort();
const measuredFiles = await Promise.all(
  sourceFiles.map(async (file) => ({
    file: relative(process.cwd(), file),
    lines: countLines(await readFile(file, 'utf8')),
  })),
);
const violations = measuredFiles.filter(({ lines }) => lines > MAX_LINES);

if (violations.length > 0) {
  console.error(`Source files must not exceed ${MAX_LINES} lines:`);
  for (const { file, lines } of violations) {
    console.error(`  ${String(lines).padStart(4)}  ${file}`);
  }
  process.exitCode = 1;
} else {
  const largest = measuredFiles.reduce((current, item) =>
    item.lines > current.lines ? item : current,
  );
  console.log(
    `File-size check passed: ${measuredFiles.length} files, largest is ${largest.file} (${largest.lines}/${MAX_LINES}).`,
  );
}
