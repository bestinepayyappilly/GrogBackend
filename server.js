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
  const data = [];
  CSVData.map((item) => {
    const generatedHtml = generateHTML(item, template);
    data.push(generatedHtml);
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
          marginBottom: 1,
          marginLeft: 3,
          marginRight: 3,
          dpi: 100,
          footerSpacing: 0,
          // pageSize: "A4",
          pageWidth: 210,
          pageHeight: 294,
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
    }
  };

  // {
  //   // output: "out.pdf",
  //   enableLocalFileAccess: true,
  //   // orientation: "Portrait",
  //   orientation: "Landscape",
  //   zoom: 1.49,
  //   marginTop: 5,
  //   marginBottom: 2,
  //   marginLeft: 3,
  //   marginRight: 3,
  //   dpi: 100,
  //   footerSpacing: 0,
  //   // noOutline: false,
  //   // marginTop: 0,
  //   // marginLeft: 0,
  //   // marginRight: 0,
  //   // marginBottom: 0,
  //   pageSize: "A4",
  //   // pageSize: "Legal",
  //   // pageWidth: 176,
  //   // pageWidth: 242,
  //   // pageHeight: 318,
  //   // pageHeight: 186,
  // }

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
      return fs.readFileSync(__dirname + "/html/ReportsWTax.html", "utf-8");
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

    const pdfBufferPromises = pdfData.map(async (item, index) => {
      const wkdata = generateWKPDF(item, typeId);

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
          resolve(concatenatedBuffer);
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

        // zipArchive.pipe(zipOutput);

        const tempDir = "temp_pdfs";
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir);
        }
        const fileWritingPromises = [];

        pdfBuffers.forEach((buffer, index) => {
          const pdfFilename = `${tempDir}/pdf_${index + 1}.pdf`;
          // fs.writeFileSync(pdfFilename, buffer);
          // zipArchive.file(pdfFilename, { name: `pdf_${index}.pdf` });
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
          zipArchive.file(pdfFilename, { name: `pdf_${index + 1}.pdf` });
        });

        // Finalize the ZIP archive
        // zipArchive.finalize();

        Promise.all(fileWritingPromises)
          .then(() => {
            // Finalize the ZIP archive once all files are written
            zipArchive.finalize();
          })
          .catch((error) => {
            console.error("Error writing files:", error);
            res.status(500).send("Internal Server Error");
          });

        // Send the ZIP file as a response
        res.contentType("application/zip");
        res.attachment("pdfs.zip");
        zipArchive.pipe(res);
      })
      .catch((err) => {
        console.log(err);
      });

    // zipOutput.pipe(res);
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
