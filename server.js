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
    const timeSinceLastUpdate = (currentTime - this.lastUpdateTime) / 1000; // in seconds
    this.lastUpdateTime = currentTime;

    // Store processing time for this batch
    this.recentTimes.push(timeSinceLastUpdate);
    // Keep only last 5 times for averaging
    if (this.recentTimes.length > 5) {
      this.recentTimes.shift();
    }

    this.processedItems += count;
    const elapsedTime = (currentTime - this.startTime) / 1000; // in seconds

    // Calculate average time per item using recent times
    const avgTimePerItem =
      this.recentTimes.reduce((a, b) => a + b, 0) / this.recentTimes.length;
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
        tracker.update();

        if (result.success) {
          errorLog.successCount++;
          const fileName = CSVData[result.index].name || `pdf_${result.index}`; // Fallback if name is undefined
          const pdfFilename = `${tempDir}/${fileName}.pdf`;
          await fs.promises.writeFile(pdfFilename, result.buffer);
          zipArchive.file(pdfFilename, { name: `${fileName}.pdf` }); // Specify name in archive
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
