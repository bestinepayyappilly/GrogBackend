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
        height: "186mm",
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
    timeout: 60000, // Increase timeout to 60 seconds
    executablePath:
      process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : puppeteer.executablePath(),
  });

  try {
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(60000); // Increase navigation timeout
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 });

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

app.post("/api/upload-html", async (req, res) => {
  const tempDir = "temp_pdfs";

  try {
    const { typeId } = req.body;
    const pdfData = generatePDF(getHtml(typeId));

    // Ensure temp directory exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Clean up old files
    const files = fs.readdirSync(tempDir);
    for (const file of files) {
      fs.unlinkSync(`${tempDir}/${file}`);
    }

    // Generate PDFs with better error handling
    const pdfBuffers = await Promise.all(
      pdfData.map(async ({ html, index }) => {
        try {
          const buffer = await generatePDFWithPuppeteer(html, typeId);
          return { buffer, index, success: true };
        } catch (error) {
          console.error(`Error generating PDF for index ${index}:`, error);
          return { index, success: false, error: error.message };
        }
      })
    );

    // Check if any PDFs failed to generate
    const failures = pdfBuffers.filter((result) => !result.success);
    if (failures.length > 0) {
      throw new Error(`Failed to generate ${failures.length} PDFs`);
    }

    const zipArchive = archiver("zip", {
      zlib: { level: 9 },
    });

    zipArchive.on("error", (err) => {
      throw err;
    });

    res.contentType("application/zip");
    res.attachment("pdfs.zip");
    zipArchive.pipe(res);

    // Add files to zip
    for (const { buffer, index } of pdfBuffers) {
      const pdfFilename = `${tempDir}/${CSVData[index].RegistrationNumber}.pdf`;
      await fs.promises.writeFile(pdfFilename, buffer);
      zipArchive.file(pdfFilename);
    }

    await zipArchive.finalize();
  } catch (error) {
    console.error("Error processing request:", error);
    // Clean up temp directory on error
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        fs.unlinkSync(`${tempDir}/${file}`);
      }
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
