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

const app = express();
const port = process.env.PORT || 8080;

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

const generatedPDF = () => {
  const data = generatePDF();
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

const generateWKPDF = (item) => {
  const data = wkhtmltopdf(item, {
    // output: "out.pdf",
    enableLocalFileAccess: true,
    orientation: "Portrait",
    // orientation: "Landscape",
    zoom: 1.49,
    marginTop: 5,
    marginBottom: 2,
    marginLeft: 3,
    marginRight: 3,
    dpi: 100,
    footerSpacing: 0,
    noOutline: false,
    pageSize: "A3",
  });
  //This is a new comment
  return data;
};

// app.post("/api/upload-html", async (req, res) => {
//   const fileValue = req.files.file.data;
//   html = new Buffer.from(fileValue).toString();
//   const data = generatePDF(html);
//   const pdfData = [];

//   data.slice(0, 1).map((item, index) => {
//     const wkdata = generateWKPDF(item);

//     wkdata.on("readable", () => {
//       var buffer = wkdata.read();
//       if (buffer) {
//         pdfData.push(buffer.toString());
//       }
//     });
//   });

//   console.log(pdfData);

//   // if (pdfData) {
//   //   res.send({ message: "received html file", pdf: pdfData });
//   // }
//   // res.contentType("blob")
//   // if (pdfgenerationstat)
//   // res.send({ message: "received html file", pdf: "" });
// });

app.post("/api/upload-html", async (req, res) => {
  try {
    const fileValue = req.files.file.data; // Assuming file upload is handled properly
    const html = Buffer.from(fileValue).toString(); // Convert the uploaded file data to HTML

    // Generate PDF data from the HTML using the generatePDF function
    const pdfData = generatePDF(html);

    // An array to store promises for generating PDF buffers
    const pdfBufferPromises = pdfData.map(async (item, index) => {
      const wkdata = generateWKPDF(item);

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

    // Wait for all PDF buffers to be generated
    const pdfBuffers = await Promise.all(pdfBufferPromises);
    console.log(pdfBuffers);
    // Create a ZIP file and add PDFs to it
    // const zipOutput = fs.createWriteStream("output.zip");
    const zipArchive = archiver("zip", {
      zlib: { level: 9 },
    });

    // zipArchive.pipe(zipOutput);

    const tempDir = "temp_pdfs";
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }

    pdfBuffers.forEach((buffer, index) => {
      const pdfFilename = `${tempDir}/pdf_${index}.pdf`;
      fs.writeFileSync(pdfFilename, buffer);
      zipArchive.file(pdfFilename, { name: `pdf_${index}.pdf` });
      zipArchive.finalize();
    });

    // Finalize the ZIP archive

    // Send the ZIP file as a response
    res.contentType("application/zip");
    res.attachment("pdfs.zip");
    zipArchive.pipe(res);

    // zipOutput.pipe(res);
  } catch (error) {
    console.error("Error processing request:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.listen(port, () => {
  console.log(`server is running on port ${port}`);
});
