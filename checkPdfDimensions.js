#!/usr/bin/env node
/**
 * checkPdfDimensions.js
 *
 * Reads one or more PDF files and reports their page dimensions.
 * Warns if any page is not A4 landscape (297 × 210 mm).
 *
 * Usage:
 *   node checkPdfDimensions.js path/to/file.pdf [path/to/another.pdf ...]
 *   node checkPdfDimensions.js path/to/directory/   # checks all PDFs in a dir
 *
 * Requires: pdf-lib (already in package.json, install with: npm install pdf-lib)
 */

const { PDFDocument } = require("pdf-lib");
const fs = require("fs");
const path = require("path");

// A4 landscape in mm (with ±1mm tolerance for rounding)
const A4_LANDSCAPE = { width: 297, height: 210 };
const TOLERANCE_MM = 1;

// 1 PDF point = 1/72 inch = 25.4/72 mm
const ptToMm = (pt) => (pt * 25.4) / 72;

async function checkFile(filePath) {
  const bytes = fs.readFileSync(filePath);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = doc.getPages();

  let allOk = true;
  const results = pages.map((page, i) => {
    const { width, height } = page.getSize();
    const wMm = ptToMm(width);
    const hMm = ptToMm(height);

    const isA4Landscape =
      Math.abs(wMm - A4_LANDSCAPE.width) <= TOLERANCE_MM &&
      Math.abs(hMm - A4_LANDSCAPE.height) <= TOLERANCE_MM;

    if (!isA4Landscape) allOk = false;

    return {
      page: i + 1,
      widthMm: wMm.toFixed(1),
      heightMm: hMm.toFixed(1),
      isA4Landscape,
    };
  });

  return { filePath, pages: results, allOk };
}

function collectPdfs(inputs) {
  const files = [];
  for (const input of inputs) {
    const stat = fs.statSync(input);
    if (stat.isDirectory()) {
      for (const f of fs.readdirSync(input)) {
        if (f.toLowerCase().endsWith(".pdf")) {
          files.push(path.join(input, f));
        }
      }
    } else {
      files.push(input);
    }
  }
  return files;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      "Usage: node checkPdfDimensions.js <file.pdf|directory> [...]"
    );
    process.exit(1);
  }

  const files = collectPdfs(args);
  if (files.length === 0) {
    console.error("No PDF files found.");
    process.exit(1);
  }

  let totalPages = 0;
  let failedPages = 0;

  for (const file of files) {
    try {
      const { filePath, pages, allOk } = await checkFile(file);
      const label = allOk ? "✓" : "✗";
      console.log(`\n${label} ${path.basename(filePath)}`);

      for (const p of pages) {
        totalPages++;
        const status = p.isA4Landscape ? "OK" : "FAIL";
        const expected = p.isA4Landscape
          ? ""
          : `  (expected ${A4_LANDSCAPE.width}×${A4_LANDSCAPE.height}mm)`;
        console.log(
          `   Page ${p.page}: ${p.widthMm} × ${p.heightMm} mm  [${status}]${expected}`
        );
        if (!p.isA4Landscape) failedPages++;
      }
    } catch (err) {
      console.error(`  ERROR reading ${file}: ${err.message}`);
    }
  }

  console.log(`\n─────────────────────────────────────`);
  console.log(`Checked ${totalPages} page(s) across ${files.length} file(s)`);
  if (failedPages === 0) {
    console.log(`All pages are A4 landscape (297×210mm). ✓`);
  } else {
    console.log(`${failedPages} page(s) are NOT A4 landscape. ✗`);
    process.exit(1);
  }
}

main();
