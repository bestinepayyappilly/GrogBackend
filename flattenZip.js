#!/usr/bin/env node
/**
 * flattenZip.js
 *
 * Moves all PDFs from subfolders into the parent folder, then removes the empty subfolders.
 *
 * Usage:
 *   node GrogBackend/flattenZip.js <directory>
 *
 * Example:
 *   node GrogBackend/flattenZip.js ./output
 */

const fs = require("fs");
const path = require("path");

const target = process.argv[2];

if (!target) {
  console.error("Usage: node flattenZip.js <directory>");
  process.exit(1);
}

const rootDir = path.resolve(target);

if (!fs.existsSync(rootDir)) {
  console.error(`Directory not found: ${rootDir}`);
  process.exit(1);
}

let moved = 0;
let skipped = 0;
let removed = 0;

const entries = fs.readdirSync(rootDir, { withFileTypes: true });

for (const entry of entries) {
  if (!entry.isDirectory()) continue;

  const subDir = path.join(rootDir, entry.name);
  const files = fs.readdirSync(subDir);

  for (const file of files) {
    if (!file.toLowerCase().endsWith(".pdf")) continue;

    const src = path.join(subDir, file);
    let dest = path.join(rootDir, file);

    // Handle filename collisions
    if (fs.existsSync(dest)) {
      const base = path.basename(file, ".pdf");
      dest = path.join(rootDir, `${base}_${entry.name}.pdf`);
      console.warn(`  collision: renamed to ${path.basename(dest)}`);
      skipped++;
    }

    fs.renameSync(src, dest);
    console.log(`  moved: ${entry.name}/${file}`);
    moved++;
  }

  // Remove subfolder if now empty
  const remaining = fs.readdirSync(subDir);
  if (remaining.length === 0) {
    fs.rmdirSync(subDir);
    console.log(`  removed folder: ${entry.name}/`);
    removed++;
  } else {
    console.warn(`  skipped non-empty folder: ${entry.name}/ (${remaining.length} files remain)`);
  }
}

console.log(`\nDone — ${moved} PDFs moved, ${skipped} renamed (collision), ${removed} folders removed.`);
