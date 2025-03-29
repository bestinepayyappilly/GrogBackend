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

const generatePDF = (template) => {
  const data = CSVData.map((item, index) => {
    const generatedHtml = generateHTML(item, template);
    return { html: generatedHtml, index };
  });

  return data;
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
        width: "4260px",
        height: "650px",
        margin: { top: "2mm", right: "2mm", bottom: "2mm", left: "2mm" },
      };
    default:
      return {
        width: "175mm",
        height: "318mm",
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
    ],
    timeout: 120000, // Increased timeout to 120 seconds
  });

  try {
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(120000); // Increased navigation timeout
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 120000 });

    const config = getPageConfig(type);
    const pdf = await page.pdf({
      ...config,
      printBackground: true,
      scale: 1.25,
      format: "A4",
      landscape: true,
    });

    return pdf;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Helper function to process PDFs in batches
async function processPDFBatch(pdfData, typeId, startIdx, batchSize) {
  const batch = pdfData.slice(startIdx, startIdx + batchSize);
  const results = [];

  for (const item of batch) {
    try {
      const buffer = await generatePDFWithPuppeteer(item.html, typeId);
      results.push({ buffer, index: item.index, success: true });
    } catch (error) {
      console.error(`Error generating PDF for index ${item.index}:`, error);
      results.push({ index: item.index, success: false, error: error.message });
    }
  }

  return results;
}

// Add this class for time tracking
class ProcessTracker {
  constructor(totalItems) {
    this.startTime = Date.now();
    this.totalItems = totalItems;
    this.processedItems = 0;

    // Create a multibar container
    this.multibar = new cliProgress.MultiBar({
      clearOnComplete: false,
      hideCursor: true,
      format:
        "{bar} {percentage}% | {value}/{total} PDFs | ETA: {eta_formatted} | Elapsed: {duration_formatted}",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
    });

    // Add the main progress bar
    this.mainBar = this.multibar.create(totalItems, 0, {
      eta_formatted: "calculating...",
      duration_formatted: "0s",
    });
  }

  update(count = 1) {
    this.processedItems += count;
    const elapsedTime = (Date.now() - this.startTime) / 1000; // in seconds
    const itemsPerSecond = this.processedItems / elapsedTime;
    const remainingItems = this.totalItems - this.processedItems;
    const eta = remainingItems / itemsPerSecond;

    // Format duration
    const duration_formatted = this.formatTime(elapsedTime);
    // Format ETA
    const eta_formatted = this.formatTime(eta);

    this.mainBar.update(this.processedItems, {
      eta_formatted,
      duration_formatted,
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

  try {
    const { typeId } = req.body;
    const pdfData = generatePDF(getHtml(typeId));
    errorLog.totalAttempted = pdfData.length;

    // Initialize progress tracker
    console.log("\nStarting PDF generation process...".cyan);
    tracker = new ProcessTracker(pdfData.length);

    // Ensure temp directory exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Clean up old files
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

    // Set up response
    res.contentType("application/zip");
    res.attachment("pdfs.zip");
    zipArchive.pipe(res);

    // Process PDFs in batches of 10
    const BATCH_SIZE = 10;
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
        // Update progress bar
        tracker.update();

        if (result.success) {
          errorLog.successCount++;
          const pdfFilename = `${tempDir}/${CSVData[result.index].name}.pdf`;
          await fs.promises.writeFile(pdfFilename, result.buffer);
          zipArchive.file(pdfFilename);
        } else {
          errorLog.failureCount++;
          errorLog.failedPDFs.push({
            name: CSVData[result.index].name,
            error: result.error,
          });
        }
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

    await zipArchive.finalize();
  } catch (error) {
    // Stop the progress bar if there's an error
    if (tracker) tracker.stop();

    console.error("\nError processing request:".red, error);
    // Clean up temp directory on error
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

function getBase64Image(filepath) {
  try {
    const image = fs.readFileSync(filepath);
    return `data:image/png;base64,${image.toString("base64")}`;
  } catch (error) {
    console.error(`Error reading image ${filepath}:`, error);
    return "";
  }
}

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

    default: {
      template = fs.readFileSync(
        __dirname + "/html/ReportsWOTax.html",
        "utf-8"
      );
    }
  }

  return template;
};

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
