const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fileUpload = require("express-fileupload");
const Papa = require("papaparse");
const Handlebars = require("handlebars");
var fs = require("fs");
const puppeteer = require("puppeteer");
const archiver = require("archiver");
var https = require("https");
const cheerio = require("cheerio");
const path = require("path");
const cliProgress = require("cli-progress");
const colors = require("colors");

const app = express();
const port = process.env.PORT || 8080;

process.setMaxListeners(20); // Increase max listeners limit

app.use(express.json());
app.use(fileUpload(), cors());
app.use(express.static("public"));
let CSVData = [];
const handleParseCSV = (csvString) => {
  Papa.parse(csvString, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
    complete: (result) => {
      CSVData = result.data;
    },
  });
};

const generateHTML = (data, template) => {
  const compiledTemplate = Handlebars.compile(template);
  return compiledTemplate(data);
};

async function convertHTMLToPDF(htmlString) {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.setContent(htmlString);
  const pdf = await page.pdf({ format: "A4" });
  await browser.close();
  return pdf;
}

const generatePDF = async (html) => {
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
  const fileValue = req.files.file.data;
  const csv = new Buffer.from(fileValue).toString();

  handleParseCSV(csv);
  res.send({ message: "received csv file" });
});

app.get("/", (req, res) => {
  res.send("hello world");
});
app.get("/test", (req, res) => {
  res.send("its working💪");
});

function getPageConfig(type) {
  switch (type) {
    case 1:
    case 2:
      return {
        width: "242mm",
        height: "160mm",
        margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
      };
    case 3:
    case 4:
    case 5:
    case 6:
    case 7:
    case 8:
    case 9:
    case 10:
    case 12:
      return {
        width: "175mm",
        height: "318mm",
        margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
      };
    case 11:
      return {
        width: "242mm",
        height: "174mm",
        margin: { top: "1mm", right: "0mm", bottom: "0mm", left: "0mm" },
      };
    case 13:
    case 14:
      return {
        width: "230mm",
        height: "165mm",
        margin: { top: "2mm", right: "0mm", bottom: "0mm", left: "0mm" },
      };

    case 15:
      return {
        width: "250mm",
        height: "160mm",
        margin: { top: "2mm", right: "2mm", bottom: "2mm", left: "2mm" },
      };
    case 16:
      return {
        width: "250mm",
        height: "160mm",
        margin: { top: "2mm", right: "2mm", bottom: "2mm", left: "2mm" },
      };
    case 17:
      return {
        width: "250mm",
        height: "160mm",
        margin: { top: "2mm", right: "2mm", bottom: "2mm", left: "2mm" },
      };
    case 18:
      return {
        width: "250mm",
        height: "160mm",
        margin: { top: "2mm", right: "2mm", bottom: "2mm", left: "2mm" },
      };
    case 19:
      return {
        width: "250mm",
        height: "160mm",
        margin: { top: "2mm", right: "2mm", bottom: "2mm", left: "2mm" },
      };
    case 20:
      return {
        width: "297mm",
        height: "210mm",
        margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
        printBackground: true,
        format: "A4",
        portrait: true,
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
    default:
      return {
        width: "250mm",
        height: "250mm",
        margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
      };
  }
}

async function generatePDFWithPuppeteer(html, type) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
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
    ],
    timeout: 60000,
  });

  try {
    const page = await browser.newPage();

    // Optimized viewport for faster rendering
    await page.setViewport({
      width: 600,
      height: 800,
      deviceScaleFactor: 1.2,
    });

    await page.setDefaultNavigationTimeout(60000);
    await page.setContent(html, { waitUntil: "networkidle2", timeout: 60000 });

    // Streamlined font loading - reduced wait time
    await page.evaluate(() => {
      return new Promise((resolve) => {
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(() => {
            setTimeout(resolve, 1000);
          });
        } else {
          setTimeout(resolve, 2000);
        }
      });
    });

    const config = getPageConfig(type);
    const pdf = await page.pdf({
      ...config,
      printBackground: true,
      preferCSSPageSize: true,
    });

    return pdf;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Helper function to process PDFs in batches with parallel processing
async function processPDFBatch(pdfData, typeId, startIdx, batchSize) {
  const batch = pdfData.slice(startIdx, startIdx + batchSize);

  // Process PDFs in parallel within the batch
  const promises = batch.map(async (item) => {
    try {
      const buffer = await generatePDFWithPuppeteer(item.html, typeId);
      return { buffer, index: item.index, success: true };
    } catch (error) {
      console.error(
        `Error generating PDF for index ${item.index}:`,
        error.message
      );
      return { index: item.index, success: false, error: error.message };
    }
  });

  // Wait for all PDFs in the batch to complete
  const results = await Promise.all(promises);
  return results;
}

// Add this class for time tracking
class ProcessTracker {
  constructor(totalItems) {
    this.startTime = Date.now();
    this.totalItems = totalItems;
    this.processedItems = 0;
    this.recentTimes = []; // Store recent processing times for better averaging

    // Create a multibar container
    this.multibar = new cliProgress.MultiBar({
      clearOnComplete: false,
      hideCursor: true,
      format:
        "[{bar}] {percentage}% | {value}/{total} PDFs | Speed: {speed} | ETA: {eta} | Elapsed: {duration}",
      barCompleteChar: "█",
      barIncompleteChar: "░",
    });

    // Add the main progress bar
    this.mainBar = this.multibar.create(totalItems, 0, {
      eta: "calculating...",
      duration: "0s",
      speed: "0 PDFs/min",
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
      });
    }
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
    const { typeId } = req.body;
    // FIX: Generate HTMLs for each CSV row
    const template = getHtml(typeId);
    const pdfData = CSVData.map((row, idx) => {
      // For NFO Invite (typeId 21), map "Customer Name" to "customerName" and add font data
      let mappedRow = row;
      if (typeId === 21) {
        mappedRow = {
          ...row,
          customerName: row["Customer Name"],
          // Add font data for NFO Invite (same as school reports)
          oggTextBook: getBase64Font(
            path.join(__dirname, "public/fonts/OggText-Book.ttf")
          ),
          oggTextBold: getBase64Font(
            path.join(__dirname, "public/fonts/OggText-Bold.ttf")
          ),
        };
      }

      return {
        html: generateHTML(mappedRow, template),
        index: idx,
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
    res.attachment("pdfs.zip");

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
    const BATCH_SIZE = 25; // Increased from 10 to 25
    const allResults = [];

    for (let i = 0; i < pdfData.length; i += BATCH_SIZE) {
      const batchResults = await processPDFBatch(
        pdfData,
        typeId,
        i,
        BATCH_SIZE
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
            // Use Customer Name for NFO invites
            const customerName = CSVData[result.index]["Customer Name"];
            fileName = generateSafeFilename(customerName, result.index);
          } else {
            // Use existing logic for other templates with index fallback
            const username = CSVData[result.index].student_username;
            fileName = username
              ? `${username}_${String(result.index).padStart(4, "0")}`
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
          zipArchive.file(pdfFilename, { name: `${finalFileName}.pdf` });
        } else {
          errorLog.failureCount++;
          errorLog.failedPDFs.push({
            name:
              CSVData[result.index]["Customer Name"] ||
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

const getHtml = (typeid) => {
  let template;
  switch (typeid) {
    case 1: {
      template = fs.readFileSync(
        __dirname + "/html/ParticipationCertificate.html",
        "utf-8"
      );
      break;
    }
    case 2: {
      template = fs.readFileSync(
        __dirname + "/html/OutstandingCerificate.html",
        "utf-8"
      );
      break;
    }
    case 3: {
      template = fs.readFileSync(__dirname + "/html/ReportsWTax.html", "utf-8");
      break;
    }
    case 4: {
      template = fs.readFileSync(
        __dirname + "/html/ReportsWOTax.html",
        "utf-8"
      );
      break;
    }
    case 5: {
      template = fs.readFileSync(
        __dirname + "/html/ReportsWTaxV1.html",
        "utf-8"
      );
      break;
    }
    case 6: {
      template = fs.readFileSync(
        __dirname + "/html/ReportsWOTaxV1.html",
        "utf-8"
      );
      break;
    }
    case 7: {
      template = fs.readFileSync(
        __dirname + "/html/ReportsWTaxV2.html",
        "utf-8"
      );
      break;
    }
    case 8: {
      template = fs.readFileSync(
        __dirname + "/html/ReportsWOTaxV2.html",
        "utf-8"
      );
      break;
    }
    case 9: {
      template = fs.readFileSync(
        __dirname + "/html/ReportsWTaxV3.html",
        "utf-8"
      );
      break;
    }
    case 10: {
      template = fs.readFileSync(
        __dirname + "/html/ReportsWOTaxV3.html",
        "utf-8"
      );
      break;
    }
    case 11: {
      template = fs.readFileSync(
        __dirname + "/html/OutstandingCertificateNationals.html",
        "utf-8"
      );
      break;
    }
    case 12: {
      template = fs.readFileSync(
        __dirname + "/html/ReportsNationals.html",
        "utf-8"
      );
      break;
    }
    case 13: {
      template = fs.readFileSync(
        __dirname + "/html/NationalsParticipationCertificate.html",
        "utf-8"
      );
      break;
    }
    case 14: {
      template = fs.readFileSync(
        __dirname + "/html/NationalsParticipationCertificateV2.html",
        "utf-8"
      );
      break;
    }
    case 15: {
      template = fs.readFileSync(
        __dirname + "/html/ZonalCertificate.html",
        "utf-8"
      );

      // Get base64 strings for all images
      const borderImage = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/NationalsZonalCertificateBorder.png"
        )
      );
      const logoImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/vector.png")
      );
      const cashfreeSignature = getBase64Image(
        path.join(__dirname, "public/cert-assets/CashfreeFounderZonal.png")
      );
      const streakSignature = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/StreakCoFounderSignatureZonal.png"
        )
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
        "utf-8"
      );

      // Get base64 strings for all images
      const borderImage = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/NationalsExcellenceCertificateBorder.png"
        )
      );
      const logoImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/vector.png")
      );
      const cashfreeSignature = getBase64Image(
        path.join(__dirname, "public/cert-assets/CashfreeFounderExcellence.png")
      );
      const streakSignature = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/StreakCoFounderSignatureExcellence.png"
        )
      );

      // Replace image paths with base64 strings
      template = template
        .replace("{{borderImage}}", borderImage)
        .replace("{{logoImage}}", logoImage)
        .replace("{{cashfreeSignature}}", cashfreeSignature)
        .replace("{{streakSignature}}", streakSignature);

      return template;
    }
    case 17: {
      template = fs.readFileSync(
        __dirname +
          "/html/Nationals2024_25OutstandingPerformanceCertificate.html",
        "utf-8"
      );

      // Get base64 strings for all images
      const borderImage = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/NationalsOutstandingCertificateBorder.png"
        )
      );
      const logoImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/vector.png")
      );
      const cashfreeSignature = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/CashFreeFounderOutstanding.png"
        )
      );
      const streakSignature = getBase64Image(
        path.join(
          __dirname,
          "public/cert-assets/StreakCoFounderSignatureOutstanding.png"
        )
      );

      // Replace image paths with base64 strings
      template = template
        .replace("{{borderImage}}", borderImage)
        .replace("{{logoImage}}", logoImage)
        .replace("{{cashfreeSignature}}", cashfreeSignature)
        .replace("{{streakSignature}}", streakSignature);

      return template;
    }
    case 18: {
      template = fs.readFileSync(
        __dirname + "/html/Nationals2024_25TeachersCertificate.html",
        "utf-8"
      );

      // Get base64 strings for all images
      const borderImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/NationalTeachersBorder.png")
      );
      const logoImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/vector.png")
      );
      const cashfreeSignature = getBase64Image(
        path.join(__dirname, "public/cert-assets/CashfreeCoFounderTeachers.png")
      );
      const streakSignature = getBase64Image(
        path.join(__dirname, "public/cert-assets/StreakCoFounderTeachers.png")
      );

      // Replace image paths with base64 strings
      template = template
        .replace("{{borderImage}}", borderImage)
        .replace("{{logoImage}}", logoImage)
        .replace("{{cashfreeSignature}}", cashfreeSignature)
        .replace("{{streakSignature}}", streakSignature);

      return template;
    }
    case 19: {
      template = fs.readFileSync(
        __dirname + "/html/Nationals2024_25PrincipalCertificate.html",
        "utf-8"
      );

      // Get base64 strings for all images
      const borderImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/NationalTeachersBorder.png")
      );
      const logoImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/vector.png")
      );
      const cashfreeSignature = getBase64Image(
        path.join(__dirname, "public/cert-assets/CashfreeCoFounderTeachers.png")
      );
      const streakSignature = getBase64Image(
        path.join(__dirname, "public/cert-assets/StreakCoFounderTeachers.png")
      );

      // Replace image paths with base64 strings
      template = template
        .replace("{{borderImage}}", borderImage)
        .replace("{{logoImage}}", logoImage)
        .replace("{{cashfreeSignature}}", cashfreeSignature)
        .replace("{{streakSignature}}", streakSignature);

      return template;
    }
    case 20: {
      template = fs.readFileSync(
        __dirname + "/html/SchoolReportNew.html",
        "utf-8"
      );

      // Get base64 string for vector.png
      const logoImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/vector.png")
      );

      // Replace logoPath in template with base64 image
      template = template.replace("{{logoPath}}", logoImage);

      return template;
    }
    case 21: {
      template = fs.readFileSync(__dirname + "/html/NFOInvite.html", "utf-8");

      // Get base64 strings for all images
      const nfoInviteImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/nfo-invite-2.png")
      );
      const qrCodeImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/image-1204.png")
      );
      const frameImage1 = getBase64Image(
        path.join(__dirname, "public/cert-assets/frame-11889.png")
      );
      const frameImage2 = getBase64Image(
        path.join(__dirname, "public/cert-assets/frame-11887.png")
      );
      const frameImage3 = getBase64Image(
        path.join(__dirname, "public/cert-assets/frame-11889-1.png")
      );
      const groupImage = getBase64Image(
        path.join(__dirname, "public/cert-assets/group-11805.png")
      );

      // Debug: Check if font files exist and log their sizes
      const oggMediumPath = path.join(
        __dirname,
        "public/fonts/OggText-Medium.ttf"
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
    default: {
      template = fs.readFileSync(
        __dirname + "/html/ReportsWOTax.html",
        "utf-8"
      );
    }
  }

  return template;
};

// Helper function to generate safe filename from customer name with unique index
const generateSafeFilename = (customerName, index) => {
  let baseName;

  if (!customerName || customerName.trim() === "") {
    baseName = "customer";
  } else {
    // Remove special characters and replace spaces with underscores
    baseName = customerName
      .trim()
      .replace(/[^a-zA-Z0-9\s]/g, "") // Remove special characters
      .replace(/\s+/g, "_") // Replace spaces with underscores
      .toLowerCase();
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
            path.join(__dirname, "public/material-symbols_trophy.png")
          ),
          backgroundImage: getBase64Image(
            path.join(__dirname, "public/cert-assets/background.png")
          ),

          // Font paths
          oggTextBook: getBase64Font(
            path.join(__dirname, "public/fonts/OggText-Book.ttf")
          ),
          oggTextLight: getBase64Font(
            path.join(__dirname, "public/fonts/OggText-Light.ttf")
          ),
          oggTextBold: getBase64Font(
            path.join(__dirname, "public/fonts/OggText-Bold.ttf")
          ),
          oggTextMedium: getBase64Font(
            path.join(__dirname, "public/fonts/OggText-Medium.ttf")
          ),
        };

        // Generate HTML
        const template = fs.readFileSync(
          path.join(__dirname, "html/SchoolReportNew.html"),
          "utf8"
        );
        const compiledTemplate = Handlebars.compile(template);
        const html = compiledTemplate(transformedData);

        // Generate PDF
        const pdf = await generatePDFWithPuppeteer(html, schoolData.type);

        // Create sanitized filename
        const sanitizedSchoolName = schoolData.schoolName
          .replace(/[^a-zA-Z0-9]/g, "_")
          .replace(/_+/g, "_")
          .toLowerCase();

        const fileName = `${sanitizedSchoolName}_report.pdf`;
        const filePath = path.join(batchDir, fileName);

        // Save PDF
        fs.writeFileSync(filePath, pdf);

        // Save relative path for response
        const relativePath = path.relative(__dirname, filePath);

        reports.push({
          schoolName: schoolData.schoolName,
          fileName: fileName,
          filePath: relativePath,
          status: "success",
        });
      } catch (error) {
        console.error(
          `Error generating report for ${schoolData.schoolName}:`,
          error
        );
        reports.push({
          schoolName: schoolData.schoolName,
          status: "error",
          error: error.message,
        });
      }
    }

    // Send response with folder information
    res.json({
      status: "success",
      message: "Reports generated successfully",
      batchInfo: {
        date: dateFolder,
        time: timeStamp,
        path: path.relative(__dirname, batchDir),
      },
      reports: reports,
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
  }
);

// Add this function to check if fonts are loaded
const areFontsLoaded = async (page) => {
  return await page.evaluate(() => {
    return Promise.all([
      document.fonts.check('12px "Ogg Text-Medium"'),
      document.fonts.check('12px "Ogg Text-Book"'),
      document.fonts.check('12px "Ogg Text-Light"'),
      document.fonts.check('12px "Ogg Text-Bold"'),
    ]).then((results) => results.every((result) => result));
  });
};

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
            })
          ),
          "Batch Grade 9 - 10": schoolData.level1["Batch Grade 9 - 10"].map(
            (student) => ({
              "Student Roll No": student["Student Roll No"],
              Name: student.Name ? student.Name.toUpperCase() : "-",
              Class: student.Class,
              "Total Score": student.Total + "%",
              "Zonal Rank": student["Zonal Rank"],
              "AIR*": student["All India Rank"],
            })
          ),
          "Batch Grade 11 - 12": schoolData.level1["Batch Grade 11 - 12"].map(
            (student) => ({
              "Student Roll No": student["Student Roll No"],
              Name: student.Name ? student.Name.toUpperCase() : "-",
              Class: student.Class,
              "Total Score": student.Total + "%",
              "Zonal Rank": student["Zonal Rank"],
              "AIR*": student["All India Rank"],
            })
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
            path.join(__dirname, "public/material-symbols_trophy.png")
          ) || "",
        backgroundImage:
          getBase64Image(
            path.join(__dirname, "public/cert-assets/background.png")
          ) || "",

        // Update font paths to match your actual files
        oggTextBook:
          getBase64Font(
            path.join(__dirname, "public/fonts/OggText-Book.ttf")
          ) || "",
        oggTextLight:
          getBase64Font(
            path.join(__dirname, "public/fonts/OggText-Light.ttf")
          ) || "",
        oggTextBold:
          getBase64Font(
            path.join(__dirname, "public/fonts/OggText-Bold.ttf")
          ) || "",
        oggTextMedium:
          getBase64Font(
            path.join(__dirname, "public/fonts/OggText-Medium.ttf")
          ) || "",
      };

      // Log asset availability
      console.log("Asset check:");
      console.log(
        "Logo:",
        fs.existsSync(path.join(__dirname, "public/Vector.png"))
      );
      console.log(
        "Vector:",
        fs.existsSync(path.join(__dirname, "public/cert-assets/vector.png"))
      );
      console.log(
        "Trophy:",
        fs.existsSync(
          path.join(__dirname, "public/material-symbols_trophy.png")
        )
      );
      console.log(
        "Background:",
        fs.existsSync(path.join(__dirname, "public/cert-assets/background.png"))
      );

      // Generate HTML
      const template = fs.readFileSync(
        path.join(__dirname, "html/SchoolReportNew.html"),
        "utf8"
      );
      const compiledTemplate = Handlebars.compile(template);
      const html = compiledTemplate(transformedData);

      // Save HTML for debugging
      fs.writeFileSync(
        path.join(
          __dirname,
          "reports/debug",
          `${schoolData.schoolName.replace(/[^a-zA-Z0-9]/g, "_")}.html`
        ),
        html
      );

      // Generate PDF
      const pdf = await generatePDF(html);

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
        `Successfully generated report for: ${schoolData.schoolName}`
      );

      reports.push({
        schoolName: schoolData.schoolName,
        fileName: fileName,
        status: "success",
      });
    } catch (error) {
      console.error(
        `Error generating report for ${schoolData.schoolName}:`,
        error
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
  }
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
