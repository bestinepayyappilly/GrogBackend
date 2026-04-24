const express = require("express");
const cors = require("cors");
const fileUpload = require("express-fileupload");
const Papa = require("papaparse");
const Handlebars = require("handlebars");
var fs = require("fs");
const puppeteer = require("puppeteer");
const archiver = require("archiver");
const path = require("path");
const cliProgress = require("cli-progress");
const colors = require("colors");
const crypto = require("crypto");
const { google } = require("googleapis");
const { Readable } = require("stream");

// ─── Google Drive / Sheets integration ───────────────────────────────────────
const GOOGLE_SERVICE_ACCOUNT_KEY = path.join(
  __dirname,
  "secrets/streakcardstoragegcloud-1f460b4dab2b.json",
);
const DRIVE_FOLDER_ID = "0AD8hq11D9Q9-Uk9PVA";
const SPREADSHEET_ID = "1PuFLa3AiwIsKoURqDuDrFOw3rwcYSQmgoHdVTcsNn0Y";

function getGoogleAuth() {
  return new google.auth.GoogleAuth({
    keyFile: GOOGLE_SERVICE_ACCOUNT_KEY,
    scopes: [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/spreadsheets",
    ],
  });
}

async function uploadPdfToDrive(pdfBuffer, fileName) {
  const sizekb = (pdfBuffer.byteLength / 1024).toFixed(1);
  console.log(`  [Drive] Uploading "${fileName}" (${sizekb} KB)...`);

  const auth = getGoogleAuth();
  const drive = google.drive({ version: "v3", auth });

  const stream = Readable.from(Buffer.from(pdfBuffer));
  const createRes = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [DRIVE_FOLDER_ID],
      mimeType: "application/pdf",
    },
    media: { mimeType: "application/pdf", body: stream },
    fields: "id",
    supportsAllDrives: true,
  });

  const fileId = createRes.data.id;
  console.log(`  [Drive] File created → id: ${fileId}`);

  console.log(`  [Drive] Setting public read permission for ${fileId}...`);
  await drive.permissions.create({
    fileId,
    requestBody: { role: "reader", type: "anyone" },
    supportsAllDrives: true,
  });

  const link = `https://drive.google.com/file/d/${fileId}/view`;
  console.log(`  [Drive] ✓ Done: ${link}`);
  return link;
}

// Converts a 0-based column index to a spreadsheet letter (0 → A, 25 → Z, 26 → AA …)
function colIndexToLetter(idx) {
  let letter = "";
  let n = idx + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

// links: [{ rowIndex: <0-based CSV row>, driveLink: <url> }]
async function writeDriveLinksToSheet(links) {
  console.log(`  [Sheets] Connecting to spreadsheet ${SPREADSHEET_ID}...`);
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: "v4", auth });

  // Identify the first sheet/tab name
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheetName = meta.data.sheets[0].properties.title;
  console.log(`  [Sheets] Using tab: "${sheetName}"`);

  // Read existing header row to find or create the "Certificate Link" column
  console.log(`  [Sheets] Reading header row...`);
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!1:1`,
  });
  const headers = headerRes.data.values?.[0] || [];
  console.log(`  [Sheets] Found ${headers.length} existing column(s): [${headers.join(", ")}]`);

  let linkColIdx = headers.indexOf("Certificate Link");
  if (linkColIdx === -1) {
    linkColIdx = headers.length;
    const col = colIndexToLetter(linkColIdx);
    console.log(`  [Sheets] "Certificate Link" column not found — creating it at column ${col}...`);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!${col}1`,
      valueInputOption: "RAW",
      requestBody: { values: [["Certificate Link"]] },
    });
    console.log(`  [Sheets] Header created at ${col}1`);
  } else {
    console.log(`  [Sheets] "Certificate Link" column already exists at ${colIndexToLetter(linkColIdx)}1`);
  }

  const col = colIndexToLetter(linkColIdx);
  // Sheet row = CSV rowIndex + 2  (row 1 = headers, rows 2+ = data)
  const data = links.map(({ rowIndex, driveLink }) => ({
    range: `${sheetName}!${col}${rowIndex + 2}`,
    values: [[driveLink]],
  }));

  console.log(`  [Sheets] Writing ${data.length} link(s) in batch to column ${col}...`);
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: "RAW", data },
  });
  console.log(`  [Sheets] ✓ Batch write complete.`);
}
// ─────────────────────────────────────────────────────────────────────────────

const app = express();
const port = process.env.PORT || 8080;

process.setMaxListeners(20); // Increase max listeners limit

app.use(express.json());
app.use(fileUpload({ limits: { fileSize: 10 * 1024 * 1024 } }), cors()); // 10MB file size limit
app.use(express.static("public"));

// Session-based CSV storage — maps sessionId → parsed CSV rows
const sessions = new Map();

// Auto-expire sessions older than 2 hours
setInterval(
  () => {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const [id, session] of sessions) {
      if (session.createdAt < cutoff) sessions.delete(id);
    }
  },
  30 * 60 * 1000,
); // run every 30 minutes

const parseCSV = (csvString) => {
  let data = [];
  Papa.parse(csvString, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
    complete: (result) => {
      data = result.data;
    },
  });
  return data;
};

const generateHTML = (data, template) => {
  const compiledTemplate = Handlebars.compile(template);
  return compiledTemplate(data);
};

const generatePDF = async (html, type = 20) => {
  try {
    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      defaultViewport: {
        width: 1024,
        height: 1440,
      },
    });

    const page = await browser.newPage();

    // Set longer timeout and wait for network idle
    await page.setDefaultNavigationTimeout(60000);
    await page.setContent(html, {
      waitUntil: ["networkidle0", "domcontentloaded"],
      timeout: 60000,
    });

    // Wait for fonts to load with explicit checks
    await page.evaluate(() => {
      return new Promise((resolve) => {
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(() => {
            // Additional wait to ensure fonts are processed
            setTimeout(resolve, 2000);
          });
        } else {
          setTimeout(resolve, 5000);
        }
      });
    });

    // Check if fonts are actually loaded
    const fontsLoaded = await page.evaluate(() => {
      return (
        document.fonts &&
        document.fonts.check &&
        document.fonts.check('16px "Ogg Text-Book"') &&
        document.fonts.check('16px "Ogg Text-Bold"')
      );
    });

    console.log("Fonts loaded:", fontsLoaded);

    const config = getPageConfig(type);

    const pdf = await page.pdf({
      ...config,
      printBackground: true,
      preferCSSPageSize: true,
    });

    await browser.close();
    return pdf;
  } catch (error) {
    console.error("Error in PDF generation:", error);
    throw new Error(`PDF generation failed: ${error.message}`);
  }
};

app.post("/api/upload_csv", (req, res) => {
  if (!req.files || !req.files.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  const csv = Buffer.from(req.files.file.data).toString();
  const rows = parseCSV(csv);
  const sessionId = crypto.randomUUID();
  const originalName = req.files.file.name || "certificates";
  sessions.set(sessionId, { rows, createdAt: Date.now(), originalName });
  res.json({ sessionId, message: "received csv file", rowCount: rows.length });
});

app.get("/", (req, res) => {
  res.send("hello world");
});
app.get("/test", (req, res) => {
  res.send("its working💪");
});

// Types that use explicit A4 format — all other types use auto-detected dimensions
const A4_TYPES = new Set([20, 21, 30]);


function getPageConfig(type) {
  switch (type) {
    case 20:
      return {
        width: "297mm",
        height: "210mm",
        margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
        printBackground: true,
        format: "A4",
        portrait: false,
        landscape: true,
      };
    case 21:
      return {
        format: "A4",
        width: "210mm",
        height: "297mm",
        margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
        printBackground: true,
        landscape: false,
        preferCSSPageSize: true,
      };
    case 30:
      return {
        format: "A4",
        width: "210mm",
        height: "297mm",
        margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
        printBackground: true,
        landscape: false,
        preferCSSPageSize: true,
      };
    default:
      // Should not be reached — certificate types use auto-detection
      return {
        width: "250mm",
        height: "250mm",
        margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
      };
  }
}

// Shared browser instance — launched once, reused for all PDFs
const BROWSER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-font-subpixel-positioning",
  "--disable-features=TranslateUI",
  "--disable-web-security",
  "--disable-features=VizDisplayCompositor",
  "--memory-pressure-off",
  "--max_old_space_size=4096",
];

let _sharedBrowser = null;
async function getSharedBrowser() {
  if (!_sharedBrowser || !_sharedBrowser.connected) {
    _sharedBrowser = await puppeteer.launch({
      headless: "new",
      args: BROWSER_ARGS,
      timeout: 60000,
    });
  }
  return _sharedBrowser;
}

// Post-processes a Puppeteer-generated PDF to add real AcroForm checkbox widgets.
// Puppeteer renders <input type="checkbox"> as static pixels; this replaces them
// with interactive pdf-lib fields at the exact positions captured via evaluate().
async function addInteractiveCheckboxesToPdf(pdfBytes, checkboxInfo, viewportWidth, viewportHeight) {
  const { PDFDocument } = require("pdf-lib");

  // A4 in PDF points (1pt = 1/72 inch; 210mm × 297mm)
  const A4_W = 595.28;
  const A4_H = 841.89;
  const sx = A4_W / viewportWidth;
  const sy = A4_H / viewportHeight;

  const pdfDoc = await PDFDocument.load(pdfBytes);
  const form = pdfDoc.getForm();
  const page = pdfDoc.getPage(0);

  for (const cb of checkboxInfo) {
    // Convert CSS (top-left origin, Y down) → PDF (bottom-left origin, Y up)
    const x = cb.x * sx;
    const y = A4_H - (cb.y + cb.height) * sy;
    const w = cb.width * sx;
    const h = cb.height * sy;

    try {
      const checkbox = form.createCheckBox(cb.name);
      checkbox.addToPage(page, { x, y, width: w, height: h });
      if (cb.checked) checkbox.check();
    } catch (err) {
      console.error(`[pdf-lib] Failed to add checkbox "${cb.name}":`, err.message);
    }
  }

  return await pdfDoc.save();
}

async function generatePDFWithPuppeteer(html, type) {
  const browser = await getSharedBrowser();
  const page = await browser.newPage();

  try {
    // A4 portrait forms (type 30): A4 at 96 CSS dpi = 794×1122px.
    // 595px viewport only covers ~446pt of the 595pt-wide A4 page, leaving
    // white edges. 794px maps exactly to 210mm so the page fills edge-to-edge.
    const viewportWidth  = type === 30 ? 794  : 1920;
    const viewportHeight = type === 30 ? 1122 : 1080; // A4 at 96dpi = 297mm = 1122px
    await page.setViewport({ width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1 });
    await page.setDefaultNavigationTimeout(60000);
    await page.setContent(html, { waitUntil: "networkidle2", timeout: 60000 });

    await page.evaluate(() => {
      return new Promise((resolve) => {
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(() => setTimeout(resolve, 1000));
        } else {
          setTimeout(resolve, 2000);
        }
      });
    });

    // For type 30: capture checkbox positions then hide the static HTML inputs
    // so the pdf-lib AcroForm widgets (added after PDF generation) are the only
    // visible and interactive checkboxes in the final PDF.
    let checkboxInfo = null;
    if (type === 30) {
      checkboxInfo = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
        const info = inputs.map((input, i) => {
          const rect = input.getBoundingClientRect();
          return {
            name: `month_${input.value || i}`,
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
            checked: input.checked,
          };
        });
        // Hide the statically rendered checkboxes so pdf-lib widgets are the
        // sole source of truth for appearance and interactivity.
        inputs.forEach((input) => { input.style.opacity = "0"; });
        return info;
      });
    }

    let pdfOptions;
    if (A4_TYPES.has(type)) {
      pdfOptions = { ...getPageConfig(type), preferCSSPageSize: type === 21 };
    } else {
      pdfOptions = {
        format: "A4",
        landscape: true,
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
      };
    }

    let pdfBytes = await page.pdf({ ...pdfOptions, printBackground: true });

    if (type === 30 && checkboxInfo && checkboxInfo.length > 0) {
      pdfBytes = await addInteractiveCheckboxesToPdf(
        pdfBytes,
        checkboxInfo,
        viewportWidth,
        viewportHeight,
      );
    }

    return pdfBytes;
  } finally {
    await page.close(); // close the page, NOT the browser
  }
}

// Helper function to process PDFs in batches with parallel processing
async function processPDFBatch(pdfData, typeId, startIdx, batchSize) {
  const batch = pdfData.slice(startIdx, startIdx + batchSize);
  const CONCURRENCY = 3; // Process 3 PDFs at a time

  const results = [];
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const chunk = batch.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (item) => {
        try {
          const rowTypeId = item.typeId || typeId;
          const buffer = await generatePDFWithPuppeteer(item.html, rowTypeId);
          return {
            buffer,
            index: item.index,
            success: true,
            typeId: rowTypeId,
          };
        } catch (error) {
          console.error(
            `Error generating PDF for index ${item.index}:`,
            error.message,
          );
          if (
            error.message.includes("Connection closed") ||
            error.message.includes("Protocol error")
          ) {
            _sharedBrowser = null;
          }
          return { index: item.index, success: false, error: error.message };
        }
      }),
    );
    results.push(...chunkResults);
  }
  return results;
}

// Add this class for time tracking
class ProcessTracker {
  constructor(totalItems) {
    this.startTime = Date.now();
    this.totalItems = totalItems;
    this.processedItems = 0;
    this.recentTimes = []; // Store recent processing times for better averaging
    this.currentStatus = "Initializing...";

    // Create a multibar container
    this.multibar = new cliProgress.MultiBar({
      clearOnComplete: false,
      hideCursor: true,
      format:
        "[{bar}] {percentage}% | {value}/{total} PDFs | Speed: {speed} | ETA: {eta} | Status: {status}",
      barCompleteChar: "█",
      barIncompleteChar: "░",
    });

    // Add the main progress bar
    this.mainBar = this.multibar.create(totalItems, 0, {
      eta: "calculating...",
      duration: "0s",
      speed: "0 PDFs/min",
      status: this.currentStatus,
    });

    // Store last update time for speed calculation
    this.lastUpdateTime = Date.now();
  }

  update(count = 1) {
    const currentTime = Date.now();
    this.processedItems += count;

    // Update progress bar less frequently for better performance
    if (
      this.processedItems % 5 === 0 ||
      this.processedItems === this.totalItems
    ) {
      const timeSinceLastUpdate = (currentTime - this.lastUpdateTime) / 1000;
      this.lastUpdateTime = currentTime;

      // Store processing time for this batch
      this.recentTimes.push(timeSinceLastUpdate);
      // Keep only last 5 times for averaging
      if (this.recentTimes.length > 5) {
        this.recentTimes.shift();
      }

      const elapsedTime = (currentTime - this.startTime) / 1000;

      // Calculate average time per item using recent times
      const avgTimePerItem =
        this.recentTimes.reduce((a, b) => a + b, 0) /
        this.recentTimes.length /
        5; // Divide by 5 since we update every 5 items
      const remainingItems = this.totalItems - this.processedItems;
      const estimatedRemainingTime = avgTimePerItem * remainingItems;

      // Calculate speed (PDFs per minute)
      const speed = Math.round((this.processedItems / elapsedTime) * 60);

      this.mainBar.update(this.processedItems, {
        eta: this.formatTime(estimatedRemainingTime),
        duration: this.formatTime(elapsedTime),
        speed: `${speed} PDFs/min`,
        status: this.currentStatus,
      });
    }
  }

  updateStatus(status) {
    this.currentStatus = status;
    // Update the bar with current status immediately
    const currentTime = Date.now();
    const elapsedTime = (currentTime - this.startTime) / 1000;
    const speed = Math.round((this.processedItems / elapsedTime) * 60) || 0;

    this.mainBar.update(this.processedItems, {
      eta:
        this.processedItems > 0
          ? this.formatTime(
              (this.totalItems - this.processedItems) /
                (this.processedItems / elapsedTime),
            )
          : "calculating...",
      duration: this.formatTime(elapsedTime),
      speed: `${speed} PDFs/min`,
      status: this.currentStatus,
    });
  }

  formatTime(seconds) {
    if (isNaN(seconds) || !isFinite(seconds)) return "calculating...";

    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const parts = [];
    if (hrs > 0) parts.push(`${hrs}h`);
    if (mins > 0) parts.push(`${mins}m`);
    parts.push(`${secs}s`);

    return parts.join(" ");
  }

  stop() {
    this.multibar.stop();
  }
}

app.post("/api/upload-html", async (req, res) => {
  const tempDir = "temp_pdfs";
  const errorLog = {
    failedPDFs: [],
    totalAttempted: 0,
    successCount: 0,
    failureCount: 0,
  };

  let tracker;
  const usedFilenames = new Set(); // Track used filenames to prevent duplicates

  try {
    const {
      typeId,
      sessionId,
      singlePDF = false,
      registrationType = "individual",
    } = req.body;

    // Validate typeId
    const validTypeIds = [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22,
      23, 24, 25, 26, 27, 28, 29, 30,
    ];
    if (!validTypeIds.includes(Number(typeId))) {
      return res.status(400).json({ error: `Invalid typeId: ${typeId}` });
    }

    // Resolve CSV data from session, with fallback to legacy global for compatibility
    const session = sessions.get(sessionId);
    const CSVData = session ? session.rows : [];
    const csvBaseName = session?.originalName
      ? path.basename(session.originalName, path.extname(session.originalName))
      : "certificates";
    if (!CSVData.length) {
      return res
        .status(400)
        .json({ error: "No CSV data found. Please upload a CSV first." });
    }

    if (singlePDF) {
      // Generate single PDF with multiple pages
      return await generateSinglePDFWithMultiplePages(
        req,
        res,
        typeId,
        CSVData,
      );
    }

    // FIX: Generate HTMLs for each CSV row
    // For KVB certificates (typeId 22 or 23), determine template based on airRank

    // typeId 29: Teachers & Principal Auto — expands each row into 1 or 2 PDF entries
    if (typeId === 29) {
      const teacherPrincipalEntries = [];
      CSVData.forEach((row, idx) => {
        const teacherTemplate = getHtml(18);
        teacherPrincipalEntries.push({
          html: generateHTML(row, teacherTemplate),
          index: teacherPrincipalEntries.length,
          typeId: 18,
          personName: (row["coordinator"] || row["Teacher name"] || "").trim(),
          csvIndex: idx,
        });
        const principalName = (row["name"] || row["Principal name"] || "").trim();
        if (principalName) {
          const principalTemplate = getHtml(19);
          teacherPrincipalEntries.push({
            html: generateHTML(row, principalTemplate),
            index: teacherPrincipalEntries.length,
            typeId: 19,
            personName: principalName,
            csvIndex: idx,
          });
        }
      });
      errorLog.totalAttempted = teacherPrincipalEntries.length;
      console.log("\nStarting PDF generation process...".cyan);
      tracker = new ProcessTracker(teacherPrincipalEntries.length);
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      const oldFiles = fs.readdirSync(tempDir);
      for (const file of oldFiles) fs.unlinkSync(`${tempDir}/${file}`);
      const zipArchive = archiver("zip", { zlib: { level: 9 } });
      zipArchive.on("error", (err) => { throw err; });
      res.contentType("application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${csvBaseName}_certificates.zip"`);
      zipArchive.pipe(res);
      res.on("finish", () => {
        const files = fs.existsSync(tempDir) ? fs.readdirSync(tempDir) : [];
        for (const file of files) fs.unlinkSync(`${tempDir}/${file}`);
        if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
      });
      const BATCH_SIZE = 15;
      for (let i = 0; i < teacherPrincipalEntries.length; i += BATCH_SIZE) {
        const batchResults = await processPDFBatch(teacherPrincipalEntries, 29, i, BATCH_SIZE);
        for (const result of batchResults) {
          tracker.update();
          if (result.success) {
            errorLog.successCount++;
            const entry = teacherPrincipalEntries[result.index];
            const rawName = entry.personName || `pdf_${String(result.index).padStart(4, "0")}`;
            let fileName = rawName.trim().replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, "_").toUpperCase();
            let finalFileName = fileName;
            let counter = 1;
            while (usedFilenames.has(finalFileName)) { finalFileName = `${fileName}_dup${counter}`; counter++; }
            usedFilenames.add(finalFileName);
            const schoolRaw = (CSVData[entry.csvIndex]["school"] || CSVData[entry.csvIndex]["School Name"] || "Unknown_School").trim();
            const schoolFolder = schoolRaw.replace(/[^a-zA-Z0-9\s,.-]/g, "").trim();
            const pdfFilename = `${tempDir}/${finalFileName}.pdf`;
            await fs.promises.writeFile(pdfFilename, result.buffer);
            zipArchive.file(pdfFilename, { name: `${schoolFolder}/${finalFileName}.pdf` });
          } else {
            errorLog.failureCount++;
            const entry = teacherPrincipalEntries[result.index];
            errorLog.failedPDFs.push({ name: entry.personName || `Unknown_${result.index}`, error: result.error });
          }
        }
        if (global.gc) global.gc();
      }
      tracker.stop();
      console.log("\nGeneration Complete!".green);
      console.log(`Successfully generated: ${errorLog.successCount}`.green);
      if (errorLog.failureCount > 0) {
        console.log(`Failed to generate: ${errorLog.failureCount}`.red);
        errorLog.failedPDFs.forEach((f, i) => console.log(`  ${i + 1}. ${f.name} — ${f.error}`.red));
      }
      await zipArchive.finalize();
      return;
    }

    const pdfData = CSVData.map((row, idx) => {
      let rowTypeId = typeId;
      let mappedRow = row;

      // For KVB certificates, determine typeId based on airRank
      if (typeId === 22 || typeId === 23) {
        const airRank = parseInt(
          row["airRank"] || row["rank"] || row["AirRank"] || "999",
        );
        // If airRank <= 10, use Outstanding certificate (23), otherwise use Participation (22)
        rowTypeId = airRank <= 10 ? 23 : 22;
      } else if (typeId === 24 || typeId === 25) {
        const airRank = parseInt(
          row["airRank"] || row["rank"] || row["AirRank"] || "999",
        );
        // If airRank <= 10, use Outstanding IR certificate (25), otherwise use Participation IR (24)
        rowTypeId = airRank <= 10 ? 25 : 24;
      } else if (typeId === 27) {
        // NFO Nationals Auto: rank 1-3 → Outstanding (17), rank 4-100 → Excellence (16), rank 101+ → Participation (14)
        const rank = parseInt(
          row["Rank"] || row["nationalRank"] || row["rank"] || "999",
        );
        if (rank >= 1 && rank <= 3) {
          rowTypeId = 17;
        } else if (rank <= 100) {
          rowTypeId = 16;
        } else {
          rowTypeId = 14;
        }
      } else if (typeId === 28) {
        // Level 1 Auto: rank 1-3 → Achievement/Outstanding (2), rank 4+ → Participation (1)
        const rank = parseInt(
          row["rank"] || row["Rank"] || row["schoolRank"] || "999",
        );
        rowTypeId = rank >= 1 && rank <= 3 ? 2 : 1;
      }

      // Normalize NFO Nationals CSV columns (School_name → school, Rank → nationalRank/rank, grade → class)
      if ([16, 17, 27].includes(typeId)) {
        mappedRow = { ...row };
        if (!mappedRow.school && mappedRow.School_name)
          mappedRow.school = mappedRow.School_name;
        if (!mappedRow.nationalRank && mappedRow.Rank)
          mappedRow.nationalRank = mappedRow.Rank;
        // Also map for Participation template (typeId 14): uses {{rank}}, {{class}}, {{date}}
        if (!mappedRow.rank && mappedRow.Rank) mappedRow.rank = mappedRow.Rank;
        if (!mappedRow.class && mappedRow.grade)
          mappedRow.class = mappedRow.grade;
        if (!mappedRow.date) mappedRow.date = "7th February 2026";
      }

      // Format date for school-level certificates (typeId 1, 2, 28)
      if ([1, 2, 28].includes(typeId)) {
        mappedRow = { ...mappedRow };
        if (mappedRow.date) mappedRow.date = formatDate(mappedRow.date);
      }

      // Get the appropriate template for this row
      const template = getHtml(rowTypeId);

      // For NFO Invite (typeId 21), map first_name and add font data
      if (typeId === 21) {
        mappedRow = {
          ...row,
          customerName:
            row["first_name"] || row["First Name"] || row["first_name"], // Support multiple column name formats
          // Add font data for NFO Invite (same as school reports)
          oggTextBook: getBase64Font(
            path.join(__dirname, "public/fonts/OggText-Book.ttf"),
          ),
          oggTextBold: getBase64Font(
            path.join(__dirname, "public/fonts/OggText-Bold.ttf"),
          ),
        };
      }

      // School Registration Form (typeId 30)
      if (typeId === 30) {
        const truthy = new Set(["true", "1", "yes", "y", "checked"]);
        const asBool = (v) =>
          typeof v === "boolean"
            ? v
            : truthy.has(String(v || "").trim().toLowerCase());

        const getValue = (...keys) => {
          for (const key of keys) {
            if (row[key] !== undefined && row[key] !== null) {
              return row[key];
            }
          }
          return "";
        };

        const normalizedLocation = normalizeRegistrationLocation(
          getValue("city", "City"),
          getValue("state", "State"),
        );

        const resolvedSchoolName = getValue("schoolName", "School Name");
        mappedRow = {
          schoolName: resolvedSchoolName,
          longSchoolName: resolvedSchoolName.length > 40,
          schoolAddress: getValue("schoolAddress", "School Address"),
          city: normalizedLocation.city,
          state: normalizedLocation.state,
          pincode: getValue("pincode", "Pincode"),
          schoolPhone: getValue("schoolPhone", "School Phone Number"),
          schoolEmail: getValue("schoolEmail", "School E-mail"),
          principalName: getValue("principalName", "Principal Name"),
          principalPhone: getValue("principalPhone", "Principal Phone Number"),
          principalEmail: getValue("principalEmail", "Principal E-mail"),
          coordinatorName: getValue("coordinatorName", "Co-ordinator Name"),
          coordinatorPhone: getValue(
            "coordinatorPhone",
            "Co-ordinator Phone Number",
          ),
          coordinatorEmail: getValue(
            "coordinatorEmail",
            "Co-ordinator E-mail",
          ),
          monthJune: asBool(getValue("monthJune", "monthJune")),
          monthJuly: asBool(getValue("monthJuly", "monthJuly")),
          monthAug: asBool(getValue("monthAug", "monthAug")),
          monthSept: asBool(getValue("monthSept", "monthSept")),
          monthOct: asBool(getValue("monthOct", "monthOct")),
          monthNov: asBool(getValue("monthNov", "monthNov")),
          signature: getValue("signature", "signature"),
          oggTextBook: getBase64Font(
            path.join(__dirname, "public/fonts/OggText-Book.ttf"),
          ),
          oggTextBold: getBase64Font(
            path.join(__dirname, "public/fonts/OggText-Bold.ttf"),
          ),
        };
      }

      return {
        html: generateHTML(mappedRow, template),
        index: idx,
        typeId: rowTypeId, // Store the typeId used for this row
      };
    });
    errorLog.totalAttempted = pdfData.length;

    // Initialize progress tracker
    console.log("\nStarting PDF generation process...".cyan);
    tracker = new ProcessTracker(pdfData.length);

    // Ensure temp directory exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Clean up old files before starting new generation
    const oldFiles = fs.readdirSync(tempDir);
    for (const file of oldFiles) {
      fs.unlinkSync(`${tempDir}/${file}`);
    }

    const zipArchive = archiver("zip", {
      zlib: { level: 9 },
    });

    zipArchive.on("error", (err) => {
      throw err;
    });

    // Set up response and cleanup after response is finished
    res.contentType("application/zip");
    res.attachment(`${csvBaseName}.zip`);

    // Handle cleanup after response is complete
    res.on("finish", () => {
      console.log("Cleaning up temporary files...");
      if (fs.existsSync(tempDir)) {
        fs.readdir(tempDir, (err, files) => {
          if (err) {
            console.error("Error reading temp directory:", err);
            return;
          }
          files.forEach((file) => {
            fs.unlink(path.join(tempDir, file), (err) => {
              if (err) console.error(`Error deleting file ${file}:`, err);
            });
          });
          // Remove directory after files are deleted
          fs.rmdir(tempDir, (err) => {
            if (err) console.error("Error removing temp directory:", err);
            else console.log("Cleanup completed successfully");
          });
        });
      }
    });

    zipArchive.pipe(res);

    // Process PDFs in larger batches for better performance
    const BATCH_SIZE = 15;
    const allResults = [];
    // Collects Drive upload jobs for typeId 30 (processed after zip is built)
    const driveUploads = [];

    for (let i = 0; i < pdfData.length; i += BATCH_SIZE) {
      const batchResults = await processPDFBatch(
        pdfData,
        typeId,
        i,
        BATCH_SIZE,
      );
      allResults.push(...batchResults);

      // Add successful PDFs to zip as they're generated
      for (const result of batchResults) {
        tracker.update();

        if (result.success) {
          errorLog.successCount++;

          // Generate filename with collision detection
          let fileName;
          if (typeId === 21) {
            // Use first_name + last_name for NFO invites
            const firstName =
              CSVData[result.index]["first_name"] ||
              CSVData[result.index]["First Name"] ||
              "";
            const lastName =
              CSVData[result.index]["last_name"] ||
              CSVData[result.index]["Last Name"] ||
              "";
            const fullName = `${firstName} ${lastName}`.trim();
            fileName = generateSafeFilename(
              fullName || "customer",
              result.index,
            );
          } else if (typeId === 18) {
            // Teachers certificate — use coordinator name
            const personName =
              CSVData[result.index]["coordinator"] ||
              CSVData[result.index]["Teacher name"] ||
              "";
            fileName = generateSafeFilename(personName || "teacher", result.index);
          } else if (typeId === 19) {
            // Principal certificate — use name field
            const personName =
              CSVData[result.index]["name"] ||
              CSVData[result.index]["Principal name"] ||
              "";
            fileName = generateSafeFilename(personName || "principal", result.index);
          } else if (typeId === 30) {
            // School Registration Form — use school name
            const schoolName =
              CSVData[result.index]["schoolName"] ||
              CSVData[result.index]["School Name"] ||
              "";
            fileName = generateSafeFilename(schoolName || "school_form", result.index);
          } else {
            // Use existing logic for other templates with index fallback
            const username =
              CSVData[result.index].username ||
              CSVData[result.index].student_username;
            fileName = username
              ? `${username}`
              : `pdf_${String(result.index).padStart(4, "0")}`;
          }

          // Additional safety check for filename uniqueness
          let finalFileName = fileName;
          let counter = 1;
          while (usedFilenames.has(finalFileName)) {
            finalFileName = `${fileName}_dup${counter}`;
            counter++;
          }
          usedFilenames.add(finalFileName);

          const pdfFilename = `${tempDir}/${finalFileName}.pdf`;
          await fs.promises.writeFile(pdfFilename, result.buffer);
          const schoolCode =
            registrationType === "school"
              ? (CSVData[result.index]["School_code"] || "unknown") + "/"
              : "";
          zipArchive.file(pdfFilename, {
            name: `${schoolCode}${finalFileName}.pdf`,
          });

          // Queue Drive upload for School Registration Forms
          if (typeId === 30) {
            driveUploads.push({
              rowIndex: result.index,
              buffer: result.buffer,
              fileName: `${finalFileName}.pdf`,
            });
          }
        } else {
          errorLog.failureCount++;
          errorLog.failedPDFs.push({
            name:
              CSVData[result.index]["first_name"] ||
              CSVData[result.index]["First Name"] ||
              CSVData[result.index].name ||
              `Unknown_${result.index}`,
            error: result.error,
          });
        }
      }

      // Force garbage collection between batches to free memory
      if (global.gc) {
        global.gc();
      }
    }

    // Stop the progress bar
    tracker.stop();

    // Print final summary
    console.log("\nGeneration Complete!".green);
    console.log(`Successfully generated: ${errorLog.successCount}`.green);
    if (errorLog.failureCount > 0) {
      console.log(`Failed to generate: ${errorLog.failureCount}`.red);
      errorLog.failedPDFs.forEach((f, i) => console.log(`  ${i + 1}. ${f.name} — ${f.error}`.red));
    }

    // Upload School Registration Form PDFs to Drive and write links to sheet
    if (typeId === 30 && driveUploads.length > 0) {
      console.log(`\n${"─".repeat(60)}`.cyan);
      console.log(`[Drive] Starting upload of ${driveUploads.length} form(s)...`.cyan);
      console.log(`[Drive] Target folder: https://drive.google.com/drive/folders/${DRIVE_FOLDER_ID}`.cyan);
      const driveStart = Date.now();
      try {
        let uploaded = 0;
        const driveLinks = await Promise.all(
          driveUploads.map(async (item) => {
            const link = await uploadPdfToDrive(item.buffer, item.fileName);
            uploaded++;
            console.log(`[Drive] Progress: ${uploaded}/${driveUploads.length}`.cyan);
            return { rowIndex: item.rowIndex, driveLink: link };
          }),
        );
        const driveElapsed = ((Date.now() - driveStart) / 1000).toFixed(1);
        console.log(`[Drive] ✓ All ${driveLinks.length} file(s) uploaded in ${driveElapsed}s`.green);

        console.log(`\n[Sheets] Writing links to spreadsheet...`.cyan);
        const sheetsStart = Date.now();
        await writeDriveLinksToSheet(driveLinks);
        const sheetsElapsed = ((Date.now() - sheetsStart) / 1000).toFixed(1);
        console.log(`[Sheets] ✓ ${driveLinks.length} link(s) written in ${sheetsElapsed}s`.green);
        console.log(`${"─".repeat(60)}\n`.cyan);
      } catch (driveErr) {
        console.error(`[Drive/Sheets] ✗ Error (PDFs still generated OK):`.red, driveErr.message);
        console.error(`[Drive/Sheets] Stack:`.red, driveErr.stack);
        console.log(`${"─".repeat(60)}\n`.cyan);
      }
    }

    // Finalize zip archive
    await zipArchive.finalize();
  } catch (error) {
    if (tracker) tracker.stop();
    console.error("\nError processing request:".red, error);

    // Clean up on error
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        fs.unlinkSync(`${tempDir}/${file}`);
      }
      fs.rmdirSync(tempDir);
    }
    res.status(500).send(`Error processing request: ${error.message}`);
  }
});

// New function to generate single PDF with multiple pages
async function generateSinglePDFWithMultiplePages(req, res, typeId, CSVData) {
  let tracker;
  try {
    console.log("\nStarting single PDF generation process...".cyan);

    // Sort CSV data alphabetically by first_name, then last_name
    const sortedCSVData = [...CSVData].sort((a, b) => {
      const firstNameA = (
        a["first_name"] ||
        a["First Name"] ||
        ""
      ).toLowerCase();
      const lastNameA = (a["last_name"] || a["Last Name"] || "").toLowerCase();
      const firstNameB = (
        b["first_name"] ||
        b["First Name"] ||
        ""
      ).toLowerCase();
      const lastNameB = (b["last_name"] || b["Last Name"] || "").toLowerCase();

      // Sort by first name first, then by last name
      if (firstNameA !== firstNameB) {
        return firstNameA.localeCompare(firstNameB);
      }
      return lastNameA.localeCompare(lastNameB);
    });

    console.log(
      `📝 Sorted ${sortedCSVData.length} records alphabetically by name`.yellow,
    );

    // Generate HTML for each sorted CSV row
    const htmlPages = sortedCSVData.map((row, idx) => {
      let rowTypeId = typeId;
      let mappedRow = row;

      // For KVB certificates, determine typeId based on airRank
      if (typeId === 22 || typeId === 23) {
        const airRank = parseInt(
          row["airRank"] || row["rank"] || row["AirRank"] || "999",
        );
        // If airRank <= 10, use Outstanding certificate (23), otherwise use Participation (22)
        rowTypeId = airRank <= 10 ? 23 : 22;
      } else if (typeId === 24 || typeId === 25) {
        const airRank = parseInt(
          row["airRank"] || row["rank"] || row["AirRank"] || "999",
        );
        // If airRank <= 10, use Outstanding IR certificate (25), otherwise use Participation IR (24)
        rowTypeId = airRank <= 10 ? 25 : 24;
      } else if (typeId === 28) {
        // Level 1 Auto: rank 1-3 → Achievement/Outstanding (2), rank 4+ → Participation (1)
        const rank = parseInt(
          row["rank"] || row["Rank"] || row["schoolRank"] || "999",
        );
        rowTypeId = rank >= 1 && rank <= 3 ? 2 : 1;
      }

      // Get the appropriate template for this row
      const rowTemplate = getHtml(rowTypeId);

      if (typeId === 21) {
        mappedRow = {
          ...row,
          customerName:
            row["first_name"] || row["First Name"] || row["first_name"], // Support multiple column name formats
          oggTextBook: getBase64Font(
            path.join(__dirname, "public/fonts/OggText-Book.ttf"),
          ),
          oggTextBold: getBase64Font(
            path.join(__dirname, "public/fonts/OggText-Bold.ttf"),
          ),
        };
      }

      return {
        html: generateHTML(mappedRow, rowTemplate),
        originalRow: row, // Keep reference to original row for filename generation
        sortedIndex: idx,
        typeId: rowTypeId, // Store the typeId used for this row
      };
    });

    console.log(
      `📄 Generated ${htmlPages.length} HTML pages for processing`.yellow,
    );
    console.log(
      `🔧 Using optimized approach: Generate individual PDFs then merge`.cyan,
    );

    // Initialize progress tracker
    tracker = new ProcessTracker(htmlPages.length);
    tracker.updateStatus("Generating individual PDF pages...");

    // NEW APPROACH: Generate individual PDFs first, then merge them
    const pdfBuffers = [];
    const BATCH_SIZE = 10; // Process in smaller batches to avoid memory issues

    for (let i = 0; i < htmlPages.length; i += BATCH_SIZE) {
      const batch = htmlPages.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map(async (pageData, batchIndex) => {
        const actualIndex = i + batchIndex;
        const firstName =
          pageData.originalRow["first_name"] ||
          pageData.originalRow["First Name"] ||
          "";
        const lastName =
          pageData.originalRow["last_name"] ||
          pageData.originalRow["Last Name"] ||
          "";
        const fullName = `${firstName} ${lastName}`.trim();

        try {
          tracker.updateStatus(
            `Processing ${fullName || `page ${actualIndex + 1}`} (${
              actualIndex + 1
            }/${htmlPages.length})...`,
          );

          // Generate individual PDF with optimized settings
          // Use row-specific typeId if available, otherwise use the default typeId
          const rowTypeId = pageData.typeId || typeId;
          const pdf = await generateOptimizedPDF(pageData.html, rowTypeId);
          tracker.update();
          return {
            pdf,
            index: actualIndex,
            success: true,
            name: fullName,
            originalRow: pageData.originalRow,
          };
        } catch (error) {
          console.error(
            `Error generating PDF for ${
              fullName || `page ${actualIndex + 1}`
            }:`,
            error.message,
          );
          tracker.update();
          return {
            index: actualIndex,
            success: false,
            error: error.message,
            name: fullName,
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);

      // Collect successful PDFs (they're already in alphabetical order)
      batchResults.forEach((result) => {
        if (result.success) {
          pdfBuffers.push({
            buffer: result.pdf,
            name: result.name,
            index: result.index,
          });
        }
      });

      // Force garbage collection between batches
      if (global.gc) {
        global.gc();
      }
    }

    tracker.updateStatus("Merging PDFs into single document...");
    console.log(
      `🔗 Merging ${pdfBuffers.length} PDF pages into single document...`.cyan,
    );

    // Extract just the buffers for merging (already in alphabetical order)
    const sortedBuffers = pdfBuffers.map((item) => item.buffer);
    console.log(
      `📊 Processing ${pdfBuffers.length} PDFs in alphabetical order:`.cyan,
    );
    pdfBuffers.slice(0, 5).forEach((item, i) => {
      console.log(`  ${i + 1}. ${item.name || "Unknown"}`.gray);
    });
    if (pdfBuffers.length > 5) {
      console.log(`  ... and ${pdfBuffers.length - 5} more`.gray);
    }

    // Merge all PDF buffers into one
    const mergedPDF = await mergePDFBuffers(sortedBuffers);

    tracker.stop();
    console.log(`✅ PDF merging completed successfully!`.green);

    // Set response headers for PDF download
    res.contentType("application/pdf");
    res.attachment(`${csvBaseName}.pdf`);

    // Send the PDF
    res.send(mergedPDF);

    console.log(
      `✅ Successfully generated single PDF with ${pdfBuffers.length} pages in alphabetical order`
        .green,
    );
  } catch (error) {
    if (tracker) tracker.stop();
    console.error("\nError generating single PDF:".red, error);
    res.status(500).send(`Error generating single PDF: ${error.message}`);
  }
}

// Optimized PDF generation for single pages — reuses shared browser
async function generateOptimizedPDF(html, type) {
  const browser = await getSharedBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.setDefaultNavigationTimeout(30000);
    await page.setContent(html, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await page.evaluate(() => {
      return new Promise((resolve) => {
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(() => setTimeout(resolve, 500));
        } else {
          setTimeout(resolve, 1000);
        }
      });
    });

    let pdfOptions;
    if (A4_TYPES.has(type)) {
      pdfOptions = { ...getPageConfig(type), preferCSSPageSize: type === 21 };
    } else {
      pdfOptions = {
        format: "A4",
        landscape: true,
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
      };
    }
    return await page.pdf({ ...pdfOptions, printBackground: true });
  } finally {
    await page.close(); // close the page, NOT the browser
  }
}

// Simple PDF merger function using native approach
async function mergePDFBuffers(pdfBuffers) {
  if (pdfBuffers.length === 0) {
    throw new Error("No PDF buffers to merge");
  }

  if (pdfBuffers.length === 1) {
    return pdfBuffers[0];
  }

  // Use pdf-lib for proper PDF merging
  try {
    const PDFDocument = require("pdf-lib").PDFDocument;

    console.log(`📚 Creating merged PDF document...`.yellow);
    const mergedPdf = await PDFDocument.create();

    for (let i = 0; i < pdfBuffers.length; i++) {
      console.log(`📄 Processing page ${i + 1}/${pdfBuffers.length}...`.gray);
      const pdf = await PDFDocument.load(pdfBuffers[i]);
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    }

    console.log(`💾 Saving merged PDF...`.yellow);
    const pdfBytes = await mergedPdf.save();
    return Buffer.from(pdfBytes);
  } catch (error) {
    console.error("❌ PDF-lib error:", error.message);

    // Fallback: Return the first PDF if merging fails
    console.warn("⚠️  PDF merging failed, using fallback approach...".yellow);
    console.warn("⚠️  Returning first PDF only as fallback.".yellow);
    return pdfBuffers[0];
  }
}

app.post("/api/generate-single-pdf", async (req, res) => {
  try {
    const { typeId, sessionId } = req.body;
    const session = sessions.get(sessionId);
    const csvData = session ? session.rows : [];
    if (!csvData.length) {
      return res
        .status(400)
        .json({ error: "No CSV data found. Please upload a CSV first." });
    }
    await generateSinglePDFWithMultiplePages(req, res, typeId, csvData);
  } catch (error) {
    console.error("Error in single PDF generation:", error);
    res.status(500).json({
      status: "error",
      message: "Error generating single PDF",
      error: error.message,
    });
  }
});

// Add this at the start of your server.js
const setupRequiredDirectories = () => {
  // Create all required directories
  const dirs = [
    path.join(__dirname, "reports"),
    path.join(__dirname, "reports/debug"),
    path.join(__dirname, "generated-reports"),
    path.join(__dirname, "public/cert-assets"),
    path.join(__dirname, "public/fonts"),
  ];

  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
};

// Format ISO date (2025-11-17) → "17th November 2025"
const formatDate = (dateStr) => {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr; // return as-is if not a valid ISO date
  const day = d.getUTCDate();
  const suffixes = ["th","st","nd","rd"];
  const v = day % 100;
  const suffix = suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0];
  const month = d.toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
  const year = d.getUTCFullYear();
  return `${day}${suffix} ${month} ${year}`;
};

// Standardize city/state values for School Registration form PDFs.
// Canonical values are derived from the current SchoolRegistration CSV and
// supplemented with alias cleanup for frequent spelling/format variations.
const REGISTRATION_STATE_CANONICAL = [
  "ANDHRA PRADESH",
  "ASSAM",
  "CHANDIGARH",
  "DELHI",
  "GOA",
  "GUJARAT",
  "HARYANA",
  "JAMMU & KASHMIR",
  "KARNATAKA",
  "KERALA",
  "MADHYA PRADESH",
  "MAHARASHTRA",
  "PONDICHERRY",
  "PUNJAB",
  "RAJASTHAN",
  "TAMIL NADU",
  "TELANGANA",
  "UTTAR PRADESH",
  "UTTARAKHAND",
  "WEST BENGAL",
];

const REGISTRATION_STATE_ALIAS = {
  "U P": "UTTAR PRADESH",
  "U.P": "UTTAR PRADESH",
  "UP": "UTTAR PRADESH",
  "U P.": "UTTAR PRADESH",
  "NEW DELHI": "DELHI",
  "TAMILNADU": "TAMIL NADU",
  "THE NILGIRIS TAMILNADU": "TAMIL NADU",
  TAMIL: "TAMIL NADU",
  "KARNATARA": "KARNATAKA",
  "KARNATAKA.": "KARNATAKA",
  TELENGANA: "TELANGANA",
  "VADODARA GUJARAT": "GUJARAT",
};

const REGISTRATION_CITY_CANONICAL = [
  "AGRA",
  "AHMEDABAD",
  "AKKALKOT",
  "BANGALORE",
  "BENGALURU",
  "BHOPAL",
  "CHANDIGARH",
  "CHENNAI",
  "CHHIBRAMAU, KANNAUJ",
  "COIMBATORE",
  "DEHRADUN",
  "DELHI",
  "DONDAICHA",
  "DURGAPUR",
  "ERODE",
  "FIROZABAD",
  "GANDHINAGAR",
  "GHAZIABAD",
  "GREATER NOIDA WEST",
  "GUNTUR",
  "GUWAHATI",
  "GURUGRAM",
  "HANUMAKONDA",
  "HISAR",
  "HOWRAH",
  "HYDERABAD",
  "JAIPUR",
  "JAMMU",
  "JORHAT",
  "KUNDAI",
  "KUPWAD (SANGLI)",
  "LAKHIMPUR-KHERI",
  "LUCKNOW",
  "LUDHIANA",
  "MUMBAI",
  "MUSSOORIE",
  "NANDURA",
  "NAVI MUMBAI",
  "NEW DELHI",
  "NOIDA",
  "OOTY",
  "PALAKKAD",
  "PANCHGANI",
  "PANIPAT",
  "PONDICHERRY",
  "PUNE",
  "SALEM",
  "SANGLI",
  "SATNA",
  "SILIGURI",
  "SOLAPUR",
  "SURAT",
  "TANUKU",
  "TENALI",
  "THOOTHUKUDI",
  "TIRUPPUR",
  "TIRUPUR",
  "TUMAKURU",
  "VADODARA",
  "VASCO DA GAMA",
  "VISAKHAPATNAM",
  "WARKADO",
  "YAVATMAL",
];

const REGISTRATION_CITY_ALIAS = {
  "PUNE 411068": "PUNE",
  "PUNE 14": "PUNE",
  "HYDRABAD 500016": "HYDERABAD",
  "GIANDHINAGAR": "GANDHINAGAR",
  "BANGALORE.": "BANGALORE",
};

const normalizeComparable = (value) =>
  String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9&]+/g, " ")
    .trim();

const levenshteinDistance = (a, b) => {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;

  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
};

const fuzzyCanonical = (value, canonicalList) => {
  const normalized = normalizeComparable(value);
  if (!normalized) return "";

  let best = "";
  let bestDistance = Number.MAX_SAFE_INTEGER;
  for (const candidate of canonicalList) {
    const distance = levenshteinDistance(normalized, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  // Accept fuzzy match only when reasonably close.
  const threshold = Math.max(2, Math.floor(normalized.length * 0.2));
  return bestDistance <= threshold ? best : normalized;
};

const normalizeRegistrationLocation = (city, state) => {
  const cityNormalized = normalizeComparable(city);
  const stateNormalized = normalizeComparable(state);

  const canonicalState =
    REGISTRATION_STATE_ALIAS[stateNormalized] ||
    fuzzyCanonical(stateNormalized, REGISTRATION_STATE_CANONICAL);

  const canonicalCity =
    REGISTRATION_CITY_ALIAS[cityNormalized] ||
    fuzzyCanonical(cityNormalized, REGISTRATION_CITY_CANONICAL);

  return {
    city: canonicalCity,
    state: canonicalState,
  };
};

// Modified getBase64Image and getBase64Font functions with error handling
const getBase64Image = (filepath) => {
  try {
    if (!fs.existsSync(filepath)) {
      console.warn(`Image not found: ${filepath}`);
      return "";
    }

    const file = fs.readFileSync(filepath);
    const extension = path.extname(filepath).toLowerCase();

    // Set correct MIME type based on file extension
    let mimeType;
    switch (extension) {
      case ".svg":
        mimeType = "image/svg+xml";
        break;
      case ".png":
        mimeType = "image/png";
        break;
      case ".jpg":
      case ".jpeg":
        mimeType = "image/jpeg";
        break;
      default:
        console.warn(`Unsupported image type: ${extension}`);
        return "";
    }

    return `data:${mimeType};base64,${file.toString("base64")}`;
  } catch (error) {
    console.error(`Error reading image ${filepath}:`, error);
    return "";
  }
};

const getBase64Font = (filepath) => {
  try {
    if (!fs.existsSync(filepath)) {
      console.warn(`Font not found: ${filepath}`);
      return ""; // Return empty string if file doesn't exist
    }
    const font = fs.readFileSync(filepath);
    return `data:font/ttf;base64,${font.toString("base64")}`;
  } catch (error) {
    console.error(`Error reading font ${filepath}:`, error);
    return ""; // Return empty string on error
  }
};

// Cache for templates that require image injection — built once, reused for every row
const templateCache = {};

const buildTemplate1 = () => {
  let t = fs.readFileSync(__dirname + "/html/ParticipationCertificate.html", "utf-8");
  return t
    .replace("{{logoImage}}", getBase64Image(path.join(__dirname, "public/cert-assets/vector.png")))
    .replace("{{cashfreeSignature}}", getBase64Image(path.join(__dirname, "public/cert-assets/ReejuDutta_NatParticipationV2.png")))
    .replace("{{sankarshanBasuSignature}}", getBase64Image(path.join(__dirname, "public/cert-assets/SankarshanBasu_ParticipationV2.png")))
    .replace("{{streakSignature}}", getBase64Image(path.join(__dirname, "public/cert-assets/ShivBidani_NatParticipationV2.png")))
    .replace("{{mitulMehtaSignature}}", getBase64Image(path.join(__dirname, "public/cert-assets/MitulMehta_ParticipationV2.png")));
};

const buildTemplate2 = () => {
  let t = fs.readFileSync(__dirname + "/html/OutstandingCerificate.html", "utf-8");
  return t
    .replace("{{logoImage}}", getBase64Image(path.join(__dirname, "public/cert-assets/vector.png")))
    .replace("{{cashfreeSignature}}", getBase64Image(path.join(__dirname, "public/cert-assets/CashFreeFounderOutstanding.png")))
    .replace("{{sankarshanBasuSignature}}", getBase64Image(path.join(__dirname, "public/cert-assets/SankarshanBasuOutstandingPerformance.png")))
    .replace("{{streakSignature}}", getBase64Image(path.join(__dirname, "public/cert-assets/StreakCoFounderSignatureOutstanding.png")))
    .replace("{{mitulMehtaSignature}}", getBase64Image(path.join(__dirname, "public/cert-assets/MitulMehtaOutstandingPerformance.png")));
};

const getHtml = (typeid) => {
  let template;
  switch (typeid) {
    case 1: {
      if (!templateCache[1]) templateCache[1] = buildTemplate1();
      return templateCache[1];
    }
    case 2: {
      if (!templateCache[2]) templateCache[2] = buildTemplate2();
      return templateCache[2];
    }
    case 3: {
      template = fs.readFileSync(__dirname + "/html/ReportsWTax.html", "utf-8");
      break;
    }
    case 4: {
      template = fs.readFileSync(
        __dirname + "/html/ReportsWOTax.html",
        "utf-8",
      );
      break;
    }
    case 5: {
      template = fs.readFileSync(
        __dirname + "/html/ReportsWTaxV1.html",
        "utf-8",
      );
      break;
    }
    case 6: {
      template = fs.readFileSync(
        __dirname + "/html/ReportsWOTaxV1.html",
        "utf-8",
      );
      break;
    }
    case 7: {
      template = fs.readFileSync(
        __dirname + "/html/ReportsWTaxV2.html",
        "utf-8",
      );
      break;
    }
    case 8: {
      template = fs.readFileSync(
        __dirname + "/html/ReportsWOTaxV2.html",
        "utf-8",
      );
      break;
    }
    case 9: {
      template = fs.readFileSync(
        __dirname + "/html/ReportsWTaxV3.html",
        "utf-8",
      );
      break;
    }
    case 10: {
      template = fs.readFileSync(
        __dirname + "/html/ReportsWOTaxV3.html",
        "utf-8",
      );
      break;
    }
    case 11: {
      template = fs.readFileSync(
        __dirname + "/html/OutstandingCertificateNationals.html",
        "utf-8",
      );
      break;
    }
    case 12: {
      template = fs.readFileSync(
        __dirname + "/html/ReportsNationals.html",
        "utf-8",
      );
      break;
    }
    case 14: {
      template = fs.readFileSync(
        __dirname + "/html/NationalsParticipationCertificateV2.html",
        "utf-8",
      );

      const borderImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/NatParticipationV2_frame.png"),
      );
      const logoImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/vector.png"),
      );
      const cashfreeSignature = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/ReejuDutta_NatParticipationV2.png",
        ),
      );
      const sankarshanBasuSignature = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/SankarshanBasu_ParticipationV2.png",
        ),
      );
      const streakSignature = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/ShivBidani_NatParticipationV2.png",
        ),
      );
      const mitulMehtaSignature = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/MitulMehta_ParticipationV2.png",
        ),
      );

      template = template
        .replace("{{borderImage}}", borderImage)
        .replace("{{logoImage}}", logoImage)
        .replace("{{cashfreeSignature}}", cashfreeSignature)
        .replace("{{sankarshanBasuSignature}}", sankarshanBasuSignature)
        .replace("{{streakSignature}}", streakSignature)
        .replace("{{mitulMehtaSignature}}", mitulMehtaSignature);

      return template;
    }
    case 15: {
      template = fs.readFileSync(
        __dirname + "/html/ZonalCertificate.html",
        "utf-8",
      );

      // Get base64 strings for all images
      const borderImage = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/NationalsZonalCertificateBorder.png",
        ),
      );
      const logoImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/vector.png"),
      );
      const cashfreeSignature = getBase64Image(
        path.join(__dirname, "public/cert-assets/CashfreeFounderZonal.png"),
      );
      const streakSignature = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/StreakCoFounderSignatureZonal.png",
        ),
      );

      // Replace image paths with base64 strings
      template = template
        .replace("{{borderImage}}", borderImage)
        .replace("{{logoImage}}", logoImage)
        .replace("{{cashfreeSignature}}", cashfreeSignature)
        .replace("{{streakSignature}}", streakSignature);

      return template;
    }
    case 16: {
      template = fs.readFileSync(
        __dirname + "/html/Nationals2024_25ExcellenceCertificate.html",
        "utf-8",
      );

      // Get base64 strings for all images
      const borderImage = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/NationalsExcellenceCertificateBorder.png",
        ),
      );
      const logoImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/vector.png"),
      );
      const cashfreeSignature = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/CashfreeFounderExcellence.png",
        ),
      );
      const sankarshanBasuSignature = getBase64Image(
        path.join(__dirname, "public/cert-assets/SankarshanBasuExcellence.png"),
      );
      const streakSignature = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/StreakCoFounderSignatureExcellence.png",
        ),
      );
      const mitulMehtaSignature = getBase64Image(
        path.join(__dirname, "public/cert-assets/MitulMehtaSignature.png"),
      );

      // Replace image paths with base64 strings
      template = template
        .replace("{{borderImage}}", borderImage)
        .replace("{{logoImage}}", logoImage)
        .replace("{{cashfreeSignature}}", cashfreeSignature)
        .replace("{{sankarshanBasuSignature}}", sankarshanBasuSignature)
        .replace("{{streakSignature}}", streakSignature)
        .replace("{{mitulMehtaSignature}}", mitulMehtaSignature);

      return template;
    }
    case 17: {
      template = fs.readFileSync(
        __dirname +
          "/html/Nationals2024_25OutstandingPerformanceCertificate.html",
        "utf-8",
      );

      // Get base64 strings for all images
      const borderImage = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/NationalsOutstandingCertificateBorder.png",
        ),
      );
      const logoImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/vector.png"),
      );
      const cashfreeSignature = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/CashFreeFounderOutstanding.png",
        ),
      );
      const sankarshanBasuSignature = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/SankarshanBasuOutstandingPerformance.png",
        ),
      );
      const streakSignature = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/StreakCoFounderSignatureOutstanding.png",
        ),
      );
      const mitulMehtaSignature = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/MitulMehtaOutstandingPerformance.png",
        ),
      );

      // Replace image paths with base64 strings
      template = template
        .replace("{{borderImage}}", borderImage)
        .replace("{{logoImage}}", logoImage)
        .replace("{{cashfreeSignature}}", cashfreeSignature)
        .replace("{{sankarshanBasuSignature}}", sankarshanBasuSignature)
        .replace("{{streakSignature}}", streakSignature)
        .replace("{{mitulMehtaSignature}}", mitulMehtaSignature);

      return template;
    }
    case 18: {
      template = fs.readFileSync(
        __dirname + "/html/Nationals2024_25TeachersCertificate.html",
        "utf-8",
      );

      // Get base64 strings for all images
      const borderImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/NationalTeachersBorder.png"),
      );
      const logoImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/vector.png"),
      );
      const cashfreeSignature = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/CashfreeCoFounderTeachers.png",
        ),
      );
      const sankarshanBasuSignature = getBase64Image(
        path.join(__dirname, "public/cert-assets/SankarshanBasuTeacherPrincipal.png"),
      );
      const streakSignature = getBase64Image(
        path.join(__dirname, "public/cert-assets/StreakCoFounderTeachers.png"),
      );
      const mitulMehtaSignature = getBase64Image(
        path.join(__dirname, "public/cert-assets/MitulMehtaTeacherPrincipal.png"),
      );

      // Replace image paths with base64 strings
      template = template
        .replace("{{borderImage}}", borderImage)
        .replace("{{logoImage}}", logoImage)
        .replace("{{cashfreeSignature}}", cashfreeSignature)
        .replace("{{sankarshanBasuSignature}}", sankarshanBasuSignature)
        .replace("{{streakSignature}}", streakSignature)
        .replace("{{mitulMehtaSignature}}", mitulMehtaSignature);

      return template;
    }
    case 19: {
      template = fs.readFileSync(
        __dirname + "/html/Nationals2024_25PrincipalCertificate.html",
        "utf-8",
      );

      // Get base64 strings for all images
      const borderImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/NationalTeachersBorder.png"),
      );
      const logoImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/vector.png"),
      );
      const cashfreeSignature = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/CashfreeCoFounderTeachers.png",
        ),
      );
      const sankarshanBasuSignature = getBase64Image(
        path.join(__dirname, "public/cert-assets/SankarshanBasuTeacherPrincipal.png"),
      );
      const streakSignature = getBase64Image(
        path.join(__dirname, "public/cert-assets/StreakCoFounderTeachers.png"),
      );
      const mitulMehtaSignature = getBase64Image(
        path.join(__dirname, "public/cert-assets/MitulMehtaTeacherPrincipal.png"),
      );

      // Replace image paths with base64 strings
      template = template
        .replace("{{borderImage}}", borderImage)
        .replace("{{logoImage}}", logoImage)
        .replace("{{cashfreeSignature}}", cashfreeSignature)
        .replace("{{sankarshanBasuSignature}}", sankarshanBasuSignature)
        .replace("{{streakSignature}}", streakSignature)
        .replace("{{mitulMehtaSignature}}", mitulMehtaSignature);

      return template;
    }
    case 20: {
      template = fs.readFileSync(
        __dirname + "/html/SchoolReportNew.html",
        "utf-8",
      );

      // Get base64 string for vector.png
      const logoImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/vector.png"),
      );

      // Replace logoPath in template with base64 image
      template = template.replace("{{logoPath}}", logoImage);

      return template;
    }
    case 21: {
      template = fs.readFileSync(__dirname + "/html/NFOInvite.html", "utf-8");

      // Get base64 strings for all images
      const nfoInviteImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/nfo-invite-2.png"),
      );
      const qrCodeImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/image-1204.png"),
      );
      const frameImage1 = getBase64Image(
        path.join(__dirname, "public/cert-assets/frame-11889.png"),
      );
      const frameImage2 = getBase64Image(
        path.join(__dirname, "public/cert-assets/frame-11887.png"),
      );
      const frameImage3 = getBase64Image(
        path.join(__dirname, "public/cert-assets/frame-11889-1.png"),
      );
      const groupImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/group-11805.png"),
      );

      // Debug: Check if font files exist and log their sizes
      const oggMediumPath = path.join(
        __dirname,
        "public/fonts/OggText-Medium.ttf",
      );
      const oggBoldPath = path.join(__dirname, "public/fonts/OggText-Bold.ttf");

      console.log("Font file checks:");
      console.log("OggText-Medium exists:", fs.existsSync(oggMediumPath));
      console.log("OggText-Bold exists:", fs.existsSync(oggBoldPath));

      if (fs.existsSync(oggMediumPath)) {
        const stats = fs.statSync(oggMediumPath);
        console.log("OggText-Medium size:", stats.size, "bytes");
      }

      if (fs.existsSync(oggBoldPath)) {
        const stats = fs.statSync(oggBoldPath);
        console.log("OggText-Bold size:", stats.size, "bytes");
      }

      // Replace only image paths with base64 strings
      template = template
        .replace("{{nfoInviteImage}}", nfoInviteImage)
        .replace("{{qrCodeImage}}", qrCodeImage)
        .replace("{{frameImage1}}", frameImage1)
        .replace("{{frameImage2}}", frameImage2)
        .replace("{{frameImage3}}", frameImage3)
        .replace("{{groupImage}}", groupImage);

      return template;
    }
    case 22: {
      template = fs.readFileSync(
        __dirname + "/html/KVBSchoolCertificate.html",
        "utf-8",
      );

      // Get base64 strings for all images
      const borderImage = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/NationalsExcellenceCertificateBorder.png",
        ),
      );
      const logoImage = getBase64Image(
        path.join(__dirname, "public/vector.svg"),
      );
      const kvbLogo = getBase64Image(
        path.join(__dirname, "public/cert-assets/KVBlogo.png"),
      );
      const underlineImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/UnderlineKVB.png"),
      );
      const kvbSignature = getBase64Image(
        path.join(__dirname, "public/cert-assets/KVBSignature.png"),
      );
      const streakSignature = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/StreakCoFounderSignatureExcellence.png",
        ),
      );
      const mitulMehtaSignature = getBase64Image(
        path.join(__dirname, "public/cert-assets/MitulMehtaSignature.png"),
      );

      // Replace image paths with base64 strings
      template = template
        .replace("{{borderImage}}", borderImage)
        .replace("{{logoImage}}", logoImage)
        .replace("{{kvbLogo}}", kvbLogo)
        .replace("{{underlineImage}}", underlineImage)
        .replace("{{kvbSignature}}", kvbSignature)
        .replace("{{streakSignature}}", streakSignature)
        .replace("{{mitulMehtaSignature}}", mitulMehtaSignature);

      return template;
    }
    case 23: {
      template = fs.readFileSync(
        __dirname + "/html/KVBSchoolCertificateOutstanding.html",
        "utf-8",
      );

      // Get base64 strings for all images
      const borderImage = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/NationalsExcellenceCertificateBorder.png",
        ),
      );
      const logoImage = getBase64Image(
        path.join(__dirname, "public/vector.svg"),
      );
      const kvbLogo = getBase64Image(
        path.join(__dirname, "public/cert-assets/KVBlogo.png"),
      );
      const underlineImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/UnderlineKVB.png"),
      );
      const kvbSignature = getBase64Image(
        path.join(__dirname, "public/cert-assets/KVBSignature.png"),
      );
      const streakSignature = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/StreakCoFounderSignatureExcellence.png",
        ),
      );
      const mitulMehtaSignature = getBase64Image(
        path.join(__dirname, "public/cert-assets/MitulMehtaSignature.png"),
      );

      // Replace image paths with base64 strings
      template = template
        .replace("{{borderImage}}", borderImage)
        .replace("{{logoImage}}", logoImage)
        .replace("{{kvbLogo}}", kvbLogo)
        .replace("{{underlineImage}}", underlineImage)
        .replace("{{kvbSignature}}", kvbSignature)
        .replace("{{streakSignature}}", streakSignature)
        .replace("{{mitulMehtaSignature}}", mitulMehtaSignature);

      return template;
    }
    case 24: {
      template = fs.readFileSync(
        __dirname + "/html/KVBSchoolCertificateIR.html",
        "utf-8",
      );

      // Get base64 strings for all images
      const borderImage = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/NationalsExcellenceCertificateBorder.png",
        ),
      );
      const logoImage = getBase64Image(
        path.join(__dirname, "public/vector.svg"),
      );
      const kvbLogo = getBase64Image(
        path.join(__dirname, "public/cert-assets/KVBlogo.png"),
      );
      const underlineImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/UnderlineKVB.png"),
      );
      const kvbSignature = getBase64Image(
        path.join(__dirname, "public/cert-assets/KVBSignature.png"),
      );
      const streakSignature = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/StreakCoFounderSignatureExcellence.png",
        ),
      );
      const mitulMehtaSignature = getBase64Image(
        path.join(__dirname, "public/cert-assets/MitulMehtaSignature.png"),
      );

      // Replace image paths with base64 strings
      template = template
        .replace("{{borderImage}}", borderImage)
        .replace("{{logoImage}}", logoImage)
        .replace("{{kvbLogo}}", kvbLogo)
        .replace("{{underlineImage}}", underlineImage)
        .replace("{{kvbSignature}}", kvbSignature)
        .replace("{{streakSignature}}", streakSignature)
        .replace("{{mitulMehtaSignature}}", mitulMehtaSignature);

      return template;
    }
    case 25: {
      template = fs.readFileSync(
        __dirname + "/html/KVBSchoolCertificateOutstandingIR.html",
        "utf-8",
      );

      // Get base64 strings for all images
      const borderImage = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/NationalsExcellenceCertificateBorder.png",
        ),
      );
      const logoImage = getBase64Image(
        path.join(__dirname, "public/vector.svg"),
      );
      const kvbLogo = getBase64Image(
        path.join(__dirname, "public/cert-assets/KVBlogo.png"),
      );
      const underlineImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/UnderlineKVB.png"),
      );
      const kvbSignature = getBase64Image(
        path.join(__dirname, "public/cert-assets/KVBSignature.png"),
      );
      const streakSignature = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/StreakCoFounderSignatureExcellence.png",
        ),
      );
      const mitulMehtaSignature = getBase64Image(
        path.join(__dirname, "public/cert-assets/MitulMehtaSignature.png"),
      );

      // Replace image paths with base64 strings
      template = template
        .replace("{{borderImage}}", borderImage)
        .replace("{{logoImage}}", logoImage)
        .replace("{{kvbLogo}}", kvbLogo)
        .replace("{{underlineImage}}", underlineImage)
        .replace("{{kvbSignature}}", kvbSignature)
        .replace("{{streakSignature}}", streakSignature)
        .replace("{{mitulMehtaSignature}}", mitulMehtaSignature);

      return template;
    }
    case 26: {
      template = fs.readFileSync(
        __dirname + "/html/KVBSchoolPrincipal.html",
        "utf-8",
      );

      const logoImage = getBase64Image(
        path.join(__dirname, "public/vector.svg"),
      );
      const kvbLogo = getBase64Image(
        path.join(__dirname, "public/cert-assets/KVBlogo.png"),
      );
      const underlineImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/UnderlineKVB.png"),
      );
      const kvbSignature = getBase64Image(
        path.join(__dirname, "public/cert-assets/KVBSignature.png"),
      );
      const streakSignature = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/StreakCoFounderSignatureExcellence.png",
        ),
      );
      const mitulMehtaSignature = getBase64Image(
        path.join(__dirname, "public/cert-assets/MitulMehtaSignature.png"),
      );

      template = template
        .replace("{{logoImage}}", logoImage)
        .replace("{{kvbLogo}}", kvbLogo)
        .replace("{{underlineImage}}", underlineImage)
        .replace("{{kvbSignature}}", kvbSignature)
        .replace("{{streakSignature}}", streakSignature)
        .replace("{{mitulMehtaSignature}}", mitulMehtaSignature);

      return template;
    }
    case 30: {
      template = fs.readFileSync(
        __dirname + "/html/SchoolRegistrationForm.html",
        "utf-8",
      );
      const logoImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/NFOLogoSingle.png"),
      );
      template = template.replace("{{logoImage}}", logoImage);
      return template;
    }
    case 27:
    default: {
      template = fs.readFileSync(
        __dirname + "/html/ReportsWOTax.html",
        "utf-8",
      );
    }
  }

  return template;
};

// Helper function to generate safe filename from full name with unique index
const generateSafeFilename = (fullName, index) => {
  let baseName;

  if (!fullName || fullName.trim() === "") {
    baseName = "customer";
  } else {
    // Remove special characters and replace spaces with underscores
    baseName = fullName
      .trim()
      .replace(/[^a-zA-Z0-9\s]/g, "") // Remove special characters
      .replace(/\s+/g, "_") // Replace spaces with underscores
      .replace(/_+/g, "_") // Replace multiple underscores with single underscore
      .toUpperCase();
  }

  // Always append the index to ensure uniqueness
  // Pad the index with zeros for better sorting (e.g., 001, 002, etc.)
  const paddedIndex = String(index).padStart(4, "0");

  return baseName ? `${baseName}_${paddedIndex}` : `customer_${paddedIndex}`;
};

// Modify your existing generate-school-report route
app.post("/api/generate-school-report", async (req, res) => {
  try {
    const schoolsData = req.body;
    const reports = [];

    // Create date-based folder structure
    const today = new Date();
    const dateFolder = `${today.getFullYear()}-${(today.getMonth() + 1)
      .toString()
      .padStart(2, "0")}-${today.getDate().toString().padStart(2, "0")}`;
    const timeStamp = `${today.getHours().toString().padStart(2, "0")}-${today
      .getMinutes()
      .toString()
      .padStart(2, "0")}`;

    // Create base reports directory and date subdirectory
    const reportsBaseDir = path.join(__dirname, "school-reports");
    const dateDir = path.join(reportsBaseDir, dateFolder);
    const batchDir = path.join(dateDir, timeStamp);

    // Create directories if they don't exist
    [reportsBaseDir, dateDir, batchDir].forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    // Handle both single school and batch of schools
    const schoolsToProcess = Array.isArray(schoolsData.response)
      ? schoolsData.response
      : [schoolsData];

    for (const schoolData of schoolsToProcess) {
      try {
        // Transform the data for the template
        const transformedData = {
          schoolName: schoolData.schoolName,
          zone: schoolData.zone,
          levelASchoolAverage: schoolData.levelASchoolAverage,
          levelANationalAverage: schoolData.levelANationalAverage,
          levelAZoneAverage: schoolData.levelAZoneAverage,
          levelBSchoolAverage: schoolData.levelBSchoolAverage,
          levelBZoneAverage: schoolData.levelBZoneAverage,
          levelBNationalAverage: schoolData.levelBNationalAverage,
          studentsResultDeclared: schoolData.studentsResultDeclared,
          studentsregistered: schoolData.studentsregistered,
          participationPercentage: schoolData.participationPercentage,
          outperformed: schoolData.outperformed,

          // Level 1 data with proper mapping
          level1: {
            "Batch Grade 6 - 8": (
              schoolData.level1["Batch Grade 6 - 8"] || []
            ).map((student) => ({
              "Student Roll No": student["Student Roll No"],
              Name: student.Name ? student.Name.toUpperCase() : "-",
              Class: student.Class,
              "Total Score": student.Total + "%",
              "Batch Rank": student["Batch Rank"],
              "AIR*": student["All India Rank"],
            })),
            "Batch Grade 9 - 10": (
              schoolData.level1["Batch Grade 9 - 10"] || []
            ).map((student) => ({
              "Student Roll No": student["Student Roll No"],
              Name: student.Name ? student.Name.toUpperCase() : "-",
              Class: student.Class,
              "Total Score": student.Total + "%",
              "Batch Rank": student["Batch Rank"],
              "AIR*": student["All India Rank"],
            })),
            "Batch Grade 11 - 12": (
              schoolData.level1["Batch Grade 11 - 12"] || []
            ).map((student) => ({
              "Student Roll No": student["Student Roll No"],
              Name: student.Name ? student.Name.toUpperCase() : "-",
              Class: student.Class,
              "Total Score": student.Total + "%",
              "Batch Rank": student["Batch Rank"],
              "AIR*": student["All India Rank"],
            })),
          },

          // Level 2 data with proper mapping
          level2: {
            "Batch Grade 6 - 8": (() => {
              const transformed = (
                schoolData.level2["Batch Grade 6 - 8"] || []
              ).map((student) => ({
                "Student Roll No": student["Student Roll No"] || "-",
                Name: student.Name ? student.Name.toUpperCase() : "-",
                Class: student.Class || "-",
                "Total Score": student.Total + "%",
                "Zonal Rank": student["Zonal Rank"],
                "AIR*": student["All India Rank"],
              }));
              console.log("Complete Grade 6-8 transformed:", transformed);
              return transformed;
            })(),

            "Batch Grade 9 - 10": (() => {
              const transformed = (
                schoolData.level2["Batch Grade 9 - 10"] || []
              ).map((student) => ({
                "Student Roll No": student["Student Roll No"] || "-",
                Name: student.Name ? student.Name.toUpperCase() : "-",
                Class: student.Class || "-",
                "Total Score": student.Total + "%",
                "Zonal Rank": student["Zonal Rank"],
                "AIR*": student["All India Rank"],
              }));
              console.log("Complete Grade 9-10 transformed:", transformed);
              return transformed;
            })(),

            "Batch Grade 11 - 12": (() => {
              const transformed = (
                schoolData.level2["Batch Grade 11 - 12"] || []
              ).map((student) => ({
                "Student Roll No": student["Student Roll No"] || "-",
                Name: student.Name ? student.Name.toUpperCase() : "-",
                Class: student.Class || "-",
                "Total Score": student.Total + "%",
                "Zonal Rank": student["Zonal Rank"],
                "AIR*": student["All India Rank"],
              }));
              console.log("Complete Grade 11-12 transformed:", transformed);
              return transformed;
            })(),
          },

          topPerformers: schoolData.topPerformers,

          // Asset paths
          logoPath: getBase64Image(path.join(__dirname, "public/vector.svg")),
          vectorIcon: getBase64Image(path.join(__dirname, "public/Vector.png")),
          statsIcon: getBase64Image(
            path.join(__dirname, "public/material-symbols_trophy.png"),
          ),
          backgroundImage: getBase64Image(
            path.join(__dirname, "public/cert-assets/background.png"),
          ),

          // Font paths
          oggTextBook: getBase64Font(
            path.join(__dirname, "public/fonts/OggText-Book.ttf"),
          ),
          oggTextLight: getBase64Font(
            path.join(__dirname, "public/fonts/OggText-Light.ttf"),
          ),
          oggTextBold: getBase64Font(
            path.join(__dirname, "public/fonts/OggText-Bold.ttf"),
          ),
          oggTextMedium: getBase64Font(
            path.join(__dirname, "public/fonts/OggText-Medium.ttf"),
          ),
        };

        // Generate HTML
        const template = fs.readFileSync(
          path.join(__dirname, "html/SchoolReportNew.html"),
          "utf8",
        );
        const compiledTemplate = Handlebars.compile(template);
        const html = compiledTemplate(transformedData);

        // Generate PDF (typeId 20 = SchoolReportNew, A4 landscape)
        const pdf = await generatePDFWithPuppeteer(html, schoolData.type || 20);

        // Create sanitized filename
        const sanitizedSchoolName = schoolData.schoolName
          .replace(/[^a-zA-Z0-9]/g, "_")
          .replace(/_+/g, "_")
          .toLowerCase();

        const fileName = `${sanitizedSchoolName}_report.pdf`;
        const filePath = path.join(batchDir, fileName);

        // Save PDF to disk (for batch; single will be streamed below)
        fs.writeFileSync(filePath, pdf);

        reports.push({
          schoolName: schoolData.schoolName,
          fileName: fileName,
          filePath: path.relative(__dirname, filePath),
          status: "success",
          pdf, // kept in memory only for single-school streaming
        });
      } catch (error) {
        console.error(
          `Error generating report for ${schoolData.schoolName}:`,
          error,
        );
        reports.push({
          schoolName: schoolData.schoolName,
          status: "error",
          error: error.message,
        });
      }
    }

    // Single school request — stream PDF directly back to client
    if (!Array.isArray(schoolsData.response)) {
      const result = reports[0];
      if (result.status === "error") {
        return res.status(500).json({ status: "error", error: result.error });
      }
      res.contentType("application/pdf");
      res.attachment(result.fileName);
      return res.send(result.pdf);
    }

    // Batch request — return JSON summary
    res.json({
      status: "success",
      message: "Reports generated successfully",
      batchInfo: {
        date: dateFolder,
        time: timeStamp,
        path: path.relative(__dirname, batchDir),
      },
      reports: reports.map(({ pdf: _pdf, ...rest }) => rest), // strip pdf buffers from JSON
    });
  } catch (error) {
    console.error("Error in report generation:", error);
    res.status(500).json({
      status: "error",
      message: "Error generating reports",
      error: error.message,
    });
  }
});

// Add this function to clean up old reports
function cleanupOldReports(directory, maxAgeHours = 24) {
  fs.readdir(directory, (err, files) => {
    if (err) {
      if (err.code !== "ENOENT")
        console.error("Error reading reports directory:", err);
      return;
    }

    const now = new Date();
    files.forEach((file) => {
      const filePath = path.join(directory, file);
      fs.stat(filePath, (err, stats) => {
        if (err) {
          console.error("Error getting file stats:", err);
          return;
        }

        const ageHours = (now - stats.mtime) / (1000 * 60 * 60);
        if (ageHours > maxAgeHours) {
          fs.unlink(filePath, (err) => {
            if (err) {
              console.error("Error deleting old report:", err);
            } else {
              console.log(`Deleted old report: ${file}`);
            }
          });
        }
      });
    });
  });
}

// Call this periodically or after generating reports
cleanupOldReports(path.join(__dirname, "reports"));
cleanupOldReports(path.join(__dirname, "reports", "debug"));

// https
//   .createServer(
//     {
//       key: fs.readFileSync("./certs/server.key"),
//       cert: fs.readFileSync("./certs/server.cert"),
//     },
//     app
//   )
//   .on("connection", function (socket) {
//     socket.setTimeout(10000);
//   })
//   .listen(port, function () {
//     console.log(`server is running on port ${port}`);
//   });

app.listen(port, function () {
  console.log(`server is running on ${port}`);
});

// Add this near the top of your server.js where you require Handlebars
Handlebars.registerHelper(
  "showLevel2Section",
  function (levelBSchoolAvg, levelBNationalAvg) {
    // Convert string percentages to numbers if needed
    const schoolAvg = parseFloat(levelBSchoolAvg);
    const nationalAvg = parseFloat(levelBNationalAvg);

    // Return false (hide) if school average is 0 OR if national average is less than school average
    return !(schoolAvg === 0 || schoolAvg < nationalAvg);
  },
);

// Add this function to check if fonts are loaded
// Add this helper before compiling the template
Handlebars.registerHelper("paginate", function (array, pageSize) {
  let pages = [];
  for (let i = 0; i < array.length; i += pageSize) {
    pages.push(array.slice(i, i + pageSize));
  }
  return pages;
});

// Add this near your other Handlebars helpers
Handlebars.registerHelper("getLevelData", function (level, batch) {
  return level[batch] || [];
});

Handlebars.registerHelper("getLevelTitle", function (levelNumber) {
  return `Level- ${levelNumber} detailed Analysis`;
});

// Add this helper in your server.js where you define other Handlebars helpers
Handlebars.registerHelper("getParentContext", function (property) {
  return this[property] || this.root[property];
});

// Add this near your other Handlebars helpers
Handlebars.registerHelper("lookup", function (obj, field) {
  return obj[field];
});

Handlebars.registerHelper("getStateFromSchool", function (schoolName) {
  const states = [
    "Andhra Pradesh",
    "Arunachal Pradesh",
    "Assam",
    "Bihar",
    "Chhattisgarh",
    "Goa",
    "Gujarat",
    "Haryana",
    "Himachal Pradesh",
    "Jharkhand",
    "Karnataka",
    "Kerala",
    "Madhya Pradesh",
    "Maharashtra",
    "Manipur",
    "Meghalaya",
    "Mizoram",
    "Nagaland",
    "Odisha",
    "Punjab",
    "Rajasthan",
    "Sikkim",
    "Tamil Nadu",
    "Telangana",
    "Tripura",
    "Uttar Pradesh",
    "Uttarakhand",
    "West Bengal",
    "Delhi",
    "Jammu and Kashmir",
  ];

  // Find matching state in school name
  const foundState = states.find((state) => schoolName.includes(state));
  return foundState || "";
});

Handlebars.registerHelper("or", function () {
  // Convert arguments to array and remove the last item (Handlebars options object)
  const args = Array.prototype.slice.call(arguments, 0, -1);
  // Return true if any argument is truthy
  return args.some((value) => !!value);
});

Handlebars.registerHelper("and", function () {
  return Array.prototype.every.call(arguments, Boolean);
});

Handlebars.registerHelper("gte", function (a, b) {
  return b >= a;
});

Handlebars.registerHelper("ne", function (a, b) {
  return a !== b;
});

Handlebars.registerHelper("eq", function (a, b) {
  return a === b;
});

Handlebars.registerHelper("not", function (value) {
  return !value;
});

const generateSchoolReports = async (schoolsData) => {
  // Setup directories first
  setupRequiredDirectories();

  const reports = [];

  for (const schoolData of schoolsData.response) {
    try {
      console.log(`Processing report for: ${schoolData.schoolName}`);

      const transformedData = {
        schoolName: schoolData.schoolName,
        zone: schoolData.zone,
        levelASchoolAverage: schoolData.levelASchoolAverage,
        levelANationalAverage: schoolData.levelANationalAverage,
        levelAZoneAverage: schoolData.levelAZoneAverage,
        levelBSchoolAverage: schoolData.levelBSchoolAverage,
        levelBZoneAverage: schoolData.levelBZoneAverage,
        levelBNationalAverage: schoolData.levelBNationalAverage,
        studentsResultDeclared: schoolData.studentsResultDeclared,
        studentsregistered: schoolData.studentsregistered,
        participationPercentage: schoolData.participationPercentage,
        outperformed: schoolData.outperformed,

        // Level 1 data
        level1: {
          "Batch Grade 6 - 8": schoolData.level1["Batch Grade 6 - 8"].map(
            (student) => ({
              "Student Roll No": student["Student Roll No"],
              Name: student.Name ? student.Name.toUpperCase() : "-",
              Class: student.Class,
              "Total Score": student.Total + "%",
              "Zonal Rank": student["Zonal Rank"],
              "AIR*": student["All India Rank"],
            }),
          ),
          "Batch Grade 9 - 10": schoolData.level1["Batch Grade 9 - 10"].map(
            (student) => ({
              "Student Roll No": student["Student Roll No"],
              Name: student.Name ? student.Name.toUpperCase() : "-",
              Class: student.Class,
              "Total Score": student.Total + "%",
              "Zonal Rank": student["Zonal Rank"],
              "AIR*": student["All India Rank"],
            }),
          ),
          "Batch Grade 11 - 12": schoolData.level1["Batch Grade 11 - 12"].map(
            (student) => ({
              "Student Roll No": student["Student Roll No"],
              Name: student.Name ? student.Name.toUpperCase() : "-",
              Class: student.Class,
              "Total Score": student.Total + "%",
              "Zonal Rank": student["Zonal Rank"],
              "AIR*": student["All India Rank"],
            }),
          ),
        },

        // Level 2 data
        level2: {
          "Batch Grade 6 - 8": (
            schoolData.level2["Batch Grade 6 - 8"] || []
          ).map((student) => ({
            "Student Roll No": student["Student Roll No"] || "-",
            Name: student.Name || "-",
            Class: student.Class || "-",
            "Total Score": student.Total + "%",
            "Zonal Rank": student["Zonal Rank"],
            "AIR*": student["All India Rank"],
          })),
          "Batch Grade 9 - 10": (
            schoolData.level2["Batch Grade 9 - 10"] || []
          ).map((student) => ({
            "Student Roll No": student["Student Roll No"] || "-",
            Name: student.Name || "-",
            Class: student.Class || "-",
            "Total Score": student.Total + "%",
            "Zonal Rank": student["Zonal Rank"],
            "AIR*": student["All India Rank"],
          })),
          "Batch Grade 11 - 12": (
            schoolData.level2["Batch Grade 11 - 12"] || []
          ).map((student) => ({
            "Student Roll No": student["Student Roll No"] || "-",
            Name: student.Name || "-",
            Class: student.Class || "-",
            "Total Score": student.Total + "%",
            "Zonal Rank": student["Zonal Rank"],
            "AIR*": student["All India Rank"],
          })),
        },

        topPerformers: schoolData.topPerformers,

        // Update image paths to match your actual files
        logoPath: getBase64Image(path.join(__dirname, "public/vector.svg")),
        vectorIcon:
          getBase64Image(path.join(__dirname, "public/Vector.png")) || "",
        statsIcon:
          getBase64Image(
            path.join(__dirname, "public/material-symbols_trophy.png"),
          ) || "",
        backgroundImage:
          getBase64Image(
            path.join(__dirname, "public/cert-assets/background.png"),
          ) || "",

        // Update font paths to match your actual files
        oggTextBook:
          getBase64Font(
            path.join(__dirname, "public/fonts/OggText-Book.ttf"),
          ) || "",
        oggTextLight:
          getBase64Font(
            path.join(__dirname, "public/fonts/OggText-Light.ttf"),
          ) || "",
        oggTextBold:
          getBase64Font(
            path.join(__dirname, "public/fonts/OggText-Bold.ttf"),
          ) || "",
        oggTextMedium:
          getBase64Font(
            path.join(__dirname, "public/fonts/OggText-Medium.ttf"),
          ) || "",
      };

      // Log asset availability
      console.log("Asset check:");
      console.log(
        "Logo:",
        fs.existsSync(path.join(__dirname, "public/Vector.png")),
      );
      console.log(
        "Vector:",
        fs.existsSync(path.join(__dirname, "public/cert-assets/vector.png")),
      );
      console.log(
        "Trophy:",
        fs.existsSync(
          path.join(__dirname, "public/material-symbols_trophy.png"),
        ),
      );
      console.log(
        "Background:",
        fs.existsSync(
          path.join(__dirname, "public/cert-assets/background.png"),
        ),
      );

      // Generate HTML
      const template = fs.readFileSync(
        path.join(__dirname, "html/SchoolReportNew.html"),
        "utf8",
      );
      const compiledTemplate = Handlebars.compile(template);
      const html = compiledTemplate(transformedData);

      // Save HTML for debugging
      fs.writeFileSync(
        path.join(
          __dirname,
          "reports/debug",
          `${schoolData.schoolName.replace(/[^a-zA-Z0-9]/g, "_")}.html`,
        ),
        html,
      );

      // Generate PDF (typeId 20 = SchoolReportNew, A4 landscape)
      const pdf = await generatePDF(html, 20);

      if (!pdf || !Buffer.isBuffer(pdf)) {
        throw new Error("PDF generation produced invalid output");
      }

      // Create sanitized filename
      const sanitizedSchoolName = schoolData.schoolName
        .replace(/[^a-zA-Z0-9]/g, "_")
        .replace(/_+/g, "_")
        .toLowerCase();

      const fileName = `${sanitizedSchoolName}_report.pdf`;
      const filePath = path.join(__dirname, "generated-reports", fileName);

      // Save PDF
      fs.writeFileSync(filePath, pdf);

      console.log(
        `Successfully generated report for: ${schoolData.schoolName}`,
      );

      reports.push({
        schoolName: schoolData.schoolName,
        fileName: fileName,
        status: "success",
      });
    } catch (error) {
      console.error(
        `Error generating report for ${schoolData.schoolName}:`,
        error,
      );
      reports.push({
        schoolName: schoolData.schoolName,
        status: "error",
        error: error.message,
      });
    }
  }

  return reports;
};

// Add this endpoint to handle batch processing
app.post("/api/generate-school-reports-batch", async (req, res) => {
  try {
    const schoolsData = req.body;

    // Create directory for reports if it doesn't exist
    const reportsDir = path.join(__dirname, "generated-reports");
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir);
    }

    // Generate reports
    const results = await generateSchoolReports(schoolsData);

    // Send response
    res.json({
      status: "success",
      message: "Reports generated successfully",
      reports: results,
    });
  } catch (error) {
    console.error("Error in batch processing:", error);
    res.status(500).json({
      status: "error",
      message: "Error generating reports",
      error: error.message,
    });
  }
});

app.post("/api/generate-school-registration-form", async (req, res) => {
  try {
    const data = req.body || {};
    const normalizedLocation = normalizeRegistrationLocation(
      data.city,
      data.state,
    );

    const templatePath = path.join(__dirname, "html/SchoolRegistrationForm.html");
    let template = fs.readFileSync(templatePath, "utf-8");

    // Inject logo as base64 so Puppeteer resolves it correctly
    template = template.replace(
      "{{logoImage}}",
      getBase64Image(path.join(__dirname, "public/cert-assets/NFOLogoSingle.png"))
    );

    const html = generateHTML(
      {
        oggTextBook: getBase64Font(path.join(__dirname, "public/fonts/OggText-Book.ttf")),
        oggTextBold: getBase64Font(path.join(__dirname, "public/fonts/OggText-Bold.ttf")),
        schoolName: data.schoolName || "",
        longSchoolName: (data.schoolName || "").length > 40,
        schoolAddress: data.schoolAddress || "",
        city: normalizedLocation.city,
        state: normalizedLocation.state,
        pincode: data.pincode || "",
        schoolPhone: data.schoolPhone || "",
        schoolEmail: data.schoolEmail || "",
        principalName: data.principalName || "",
        principalPhone: data.principalPhone || "",
        principalEmail: data.principalEmail || "",
        coordinatorName: data.coordinatorName || "",
        coordinatorPhone: data.coordinatorPhone || "",
        coordinatorEmail: data.coordinatorEmail || "",
        monthJune: data.monthJune || false,
        monthJuly: data.monthJuly || false,
        monthAug: data.monthAug || false,
        monthSept: data.monthSept || false,
        monthOct: data.monthOct || false,
        monthNov: data.monthNov || false,
        signature: data.signature || "",
      },
      template
    );

    const pdfBuffer = await generatePDFWithPuppeteer(html, 30);

    const schoolSlug = (data.schoolName || "school")
      .replace(/[^a-z0-9]/gi, "_")
      .toLowerCase();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="NFO_RegistrationForm_${schoolSlug}.pdf"`
    );
    res.send(pdfBuffer);
  } catch (error) {
    console.error("Error generating school registration form:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to generate school registration form",
      error: error.message,
    });
  }
});

Handlebars.registerHelper("longSchoolName", function (name) {
  return typeof name === "string" && name.length > 40;
});

Handlebars.registerHelper("default", function (value, defaultValue) {
  // Check for null, undefined, empty string, or only whitespace
  return value != null && value !== "" && String(value).trim() !== ""
    ? value
    : defaultValue;
});

// Add this helper where you define other Handlebars helpers
Handlebars.registerHelper("getSchoolNameClass", function (schoolName) {
  // Check if schoolName is undefined or null
  if (!schoolName) return "school-name";

  // Count the number of characters and words
  const charCount = schoolName.length;
  const wordCount = schoolName.split(/[\s,]+/).length;

  // Return appropriate class based on length
  if (charCount > 80) return "school-name very-long";
  if (charCount > 50 || wordCount > 5) return "school-name long";
  return "school-name";
});

// Add this near your other Handlebars helpers
Handlebars.registerHelper(
  "showLevel1Section",
  function (levelASchoolAvg, levelANationalAvg) {
    // Convert string percentages to numbers if needed
    const schoolAvg = parseFloat(levelASchoolAvg);
    const nationalAvg = parseFloat(levelANationalAvg);

    // Return false (hide) if school average is greater than national average
    return !(schoolAvg < nationalAvg);
  },
);

// Add this near your other Handlebars helpers
Handlebars.registerHelper("capitalizeFirst", function (str) {
  if (!str || typeof str !== "string") {
    return str;
  }

  // Split by spaces and capitalize first letter of each word
  return str
    .split(" ")
    .map((word) => {
      if (word.length === 0) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
});

Handlebars.registerHelper("getNameSizeClass", function (name) {
  if (!name || typeof name !== "string") {
    return "medium";
  }

  const nameLength = name.length;

  if (nameLength > 35) {
    return "xsmall"; // 22px — very long names like "M CHARANJIT HARSHAVARDHAN"
  } else if (nameLength > 25) {
    return "small"; // 30px
  } else if (nameLength > 15) {
    return "medium"; // 40px
  } else {
    return "large"; // 60px
  }
});
