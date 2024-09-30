const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fileUpload = require("express-fileupload");
const Papa = require("papaparse");
const Handlebars = require("handlebars");
var fs = require("fs");
const puppeteer = require("puppeteer");
var wkhtmltopdf = require("wkhtmltopdf");
const archiver = require("archiver");
var https = require("https");
const cheerio = require("cheerio");

const app = express();
const port = process.env.PORT || 443;

app.use(express.json());
app.use(fileUpload(), cors());
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
  const browser = await puppeteer.launch({ headless: "new" });
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

const generateWKPDF = (item, type) => {
  const generationType = (type) => {
    switch (type) {
      case 1: {
        return {
          enableLocalFileAccess: true,
          orientation: "Landscape",
          zoom: 1.47,
          marginTop: 5,
          marginBottom: 0,
          marginLeft: 3,
          marginRight: 3,
          dpi: 100,
          footerSpacing: 0,
          pageWidth: 210,
          pageHeight: 294,
          footerSpacing: 0,
          noOutline: false,
        };
      }
      case 2: {
        return {
          enableLocalFileAccess: true,
          zoom: 1.49,
          dpi: 100,
          footerSpacing: 0,
          noOutline: false,
          marginTop: 0,
          marginLeft: 0,
          marginRight: 0,
          marginBottom: 0,
          pageWidth: 242,
          pageHeight: 186,
        };
      }
      case 3: {
        return {
          enableLocalFileAccess: true,
          orientation: "Portrait",
          zoom: 1.49,
          dpi: 100,
          footerSpacing: 0,
          marginTop: 0,
          marginLeft: 0,
          marginRight: 0,
          marginBottom: 0,
          pageWidth: 175,
          pageHeight: 318,
        };
      }

      case 4: {
        return {
          enableLocalFileAccess: true,
          orientation: "Portrait",
          zoom: 1.49,
          dpi: 100,
          footerSpacing: 0,
          marginTop: 0,
          marginLeft: 0,
          marginRight: 0,
          marginBottom: 0,
          pageWidth: 175,
          pageHeight: 318,
        };
      }
      case 5: {
        return {
          enableLocalFileAccess: true,
          orientation: "Portrait",
          zoom: 1.49,
          dpi: 100,
          footerSpacing: 0,
          marginTop: 0,
          marginLeft: 0,
          marginRight: 0,
          marginBottom: 0,
          pageWidth: 175,
          pageHeight: 318,
        };
      }
      case 6: {
        return {
          enableLocalFileAccess: true,
          orientation: "Portrait",
          zoom: 1.49,
          dpi: 100,
          footerSpacing: 0,
          marginTop: 0,
          marginLeft: 0,
          marginRight: 0,
          marginBottom: 0,
          pageWidth: 175,
          pageHeight: 318,
        };
      }
      case 7: {
        return {
          enableLocalFileAccess: true,
          orientation: "Portrait",
          zoom: 1.49,
          dpi: 100,
          footerSpacing: 0,
          marginTop: 0,
          marginLeft: 0,
          marginRight: 0,
          marginBottom: 0,
          pageWidth: 175,
          pageHeight: 318,
        };
      }
      case 8: {
        return {
          enableLocalFileAccess: true,
          orientation: "Portrait",
          zoom: 1.49,
          dpi: 100,
          footerSpacing: 0,
          marginTop: 0,
          marginLeft: 0,
          marginRight: 0,
          marginBottom: 0,
          pageWidth: 175,
          pageHeight: 318,
        };
      }
      case 9: {
        return {
          enableLocalFileAccess: true,
          orientation: "Portrait",
          zoom: 1.49,
          dpi: 100,
          footerSpacing: 0,
          marginTop: 0,
          marginLeft: 0,
          marginRight: 0,
          marginBottom: 0,
          pageWidth: 175,
          pageHeight: 318,
        };
      }
      case 10: {
        return {
          enableLocalFileAccess: true,
          orientation: "Portrait",
          zoom: 1.49,
          dpi: 100,
          footerSpacing: 0,
          marginTop: 0,
          marginLeft: 0,
          marginRight: 0,
          marginBottom: 0,
          pageWidth: 175,
          pageHeight: 318,
        };
      }
      case 11: {
        return {
          enableLocalFileAccess: true,
          zoom: 1.49,
          dpi: 100,
          footerSpacing: 0,
          noOutline: false,
          marginTop: 1,
          marginLeft: 0,
          marginRight: 0,
          marginBottom: 0,
          pageWidth: 242,
          pageHeight: 174,
        };
      }
      case 12: {
        return {
          enableLocalFileAccess: true,
          orientation: "Portrait",
          zoom: 1.49,
          dpi: 100,
          footerSpacing: 0,
          marginTop: 0,
          marginLeft: 0,
          marginRight: 0,
          marginBottom: 0,
          pageWidth: 175,
          pageHeight: 318,
        };
      }
      case 13: {
        return {
          enableLocalFileAccess: true,
          zoom: 1.49,
          dpi: 100,
          footerSpacing: 0,
          noOutline: false,
          marginTop: 2,
          marginLeft: 0,
          marginRight: 0,
          marginBottom: 0,
          pageWidth: 230,
          pageHeight: 165,
        };
      }
      case 14: {
        return {
          enableLocalFileAccess: true,
          zoom: 1.49,
          dpi: 100,
          footerSpacing: 0,
          noOutline: false,
          marginTop: 2,
          marginLeft: 0,
          marginRight: 0,
          marginBottom: 0,
          pageWidth: 230,
          pageHeight: 165,
        };
      }

      default: {
        return {
          enableLocalFileAccess: true,
          orientation: "Portrait",
          zoom: 1.49,
          dpi: 100,
          footerSpacing: 0,
          marginTop: 0,
          marginLeft: 0,
          marginRight: 0,
          marginBottom: 0,
          pageWidth: 175,
          pageHeight: 318,
        };
      }
    }
  };

  const data = wkhtmltopdf(item, generationType(type));
  return data;
};

const getHtml = (typeid) => {
  switch (typeid) {
    case 1: {
      return fs.readFileSync(
        __dirname + "/html/ParticipationCertificate.html",
        "utf-8"
      );
    }
    case 2: {
      return fs.readFileSync(
        __dirname + "/html/OutstandingCerificate.html",
        "utf-8"
      );
    }
    case 3: {
      return fs.readFileSync(__dirname + "/html/ReportsWTax.html", "utf-8");
    }
    case 4: {
      return fs.readFileSync(__dirname + "/html/ReportsWOTax.html", "utf-8");
    }
    case 5: {
      return fs.readFileSync(__dirname + "/html/ReportsWTaxV1.html", "utf-8");
    }
    case 6: {
      return fs.readFileSync(__dirname + "/html/ReportsWOTaxV1.html", "utf-8");
    }
    case 7: {
      return fs.readFileSync(__dirname + "/html/ReportsWTaxV2.html", "utf-8");
    }
    case 8: {
      return fs.readFileSync(__dirname + "/html/ReportsWOTaxV2.html", "utf-8");
    }
    case 9: {
      return fs.readFileSync(__dirname + "/html/ReportsWTaxV3.html", "utf-8");
    }
    case 10: {
      return fs.readFileSync(__dirname + "/html/ReportsWOTaxV3.html", "utf-8");
    }
    case 11: {
      return fs.readFileSync(
        __dirname + "/html/OutstandingCertificateNationals.html",
        "utf-8"
      );
    }
    case 12: {
      return fs.readFileSync(
        __dirname + "/html/ReportsNationals.html",
        "utf-8"
      );
    }
    case 13: {
      return fs.readFileSync(
        __dirname + "/html/NationalsParticipationCertificate.html",
        "utf-8"
      );
    }
    case 14: {
      return fs.readFileSync(
        __dirname + "/html/NationalsParticipationCertificateV2.html",
        "utf-8"
      );
    }

    default: {
      return fs.readFileSync(__dirname + "/html/ReportsWOTax.html", "utf-8");
    }
  }
};

app.post("/api/upload-html", async (req, res) => {
  try {
    const { typeId } = req.body;

    const pdfData = generatePDF(getHtml(typeId));

    const pdfBufferPromises = pdfData.map(async ({ html, index }) => {
      const wkdata = generateWKPDF(html, typeId);

      const pdfBuffer = await new Promise((resolve, reject) => {
        const buffers = [];
        wkdata.on("readable", () => {
          let buffer = wkdata.read();
          while (buffer) {
            buffers.push(buffer);
            buffer = wkdata.read();
          }
        });

        wkdata.on("end", () => {
          const concatenatedBuffer = Buffer.concat(buffers);
          resolve({ buffer: concatenatedBuffer, index });
        });

        wkdata.on("error", reject);
      });

      return pdfBuffer;
    });

    Promise.all(pdfBufferPromises)
      .then((pdfBuffers) => {
        console.log(pdfBuffers);
        const zipArchive = archiver("zip", {
          zlib: { level: 9 },
        });

        const tempDir = "temp_pdfs";
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir);
        }

        const fileWritingPromises = [];

        pdfBuffers.forEach(({ buffer, index }) => {
          const pdfFilename = `${tempDir}/${CSVData[index].RegistrationNumber}.pdf`;
          const fileWritePromise = new Promise((resolve, reject) => {
            fs.writeFile(pdfFilename, buffer, (err) => {
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            });
          });
          fileWritingPromises.push(fileWritePromise);
          zipArchive.file(pdfFilename);
        });

        Promise.all(fileWritingPromises)
          .then(() => {
            zipArchive.finalize();
            // fs.rmdir(tempDir, { recursive: true }, (err) => {
            //   if (err) {
            //     console.error("Error deleting temporary folder:", err);
            //   } else {
            //     console.log("Temporary folder deleted");
            //   }
            // });
          })
          .catch((error) => {
            console.error("Error writing files:", error);
            res.status(500).send("Internal Server Error");
          });

        res.contentType("application/zip");
        res.attachment("pdfs.zip");
        zipArchive.pipe(res);
      })
      .catch((err) => {
        console.log(err);
      });
  } catch (error) {
    console.error("Error processing request:", error);
    res.status(500).send("Internal Server Error");
  }
});

https
  .createServer(
    {
      key: fs.readFileSync("./certs/server.key"),
      cert: fs.readFileSync("./certs/server.cert"),
    },
    app
  )
  .on("connection", function (socket) {
    socket.setTimeout(10000);
  })
  .listen(port, function () {
    console.log(`server is running on port ${port}`);
  });

// app.listen(port, function () {
//   console.log(`server is running on ${port}`);
// });
