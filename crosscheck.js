const fs = require("fs");
const { parse } = require("csv-parse");
const { stringify } = require("csv-stringify");
const path = require("path");
const PDFParser = require("pdf2json");

async function findMissingPDFs() {
  const csvFilePath = "./check.csv";
  const pdfFolderPath = "./checkpdf";
  const outputCSVPath = "./missing_pdfs.csv";

  // Get list of PDF files
  const pdfFiles = fs
    .readdirSync(pdfFolderPath)
    .filter((file) => file.toLowerCase().endsWith(".pdf"));

  // Read and parse CSV
  const parseCSV = () => {
    return new Promise((resolve, reject) => {
      const names = [];
      fs.createReadStream(csvFilePath)
        .pipe(
          parse({
            columns: true,
            skip_empty_lines: true,
          })
        )
        .on("data", (row) => {
          names.push(row.name);
        })
        .on("end", () => {
          resolve(names);
        })
        .on("error", reject);
    });
  };

  // Save missing names to CSV
  const saveMissingToCSV = (missingNames) => {
    return new Promise((resolve, reject) => {
      // Prepare data for CSV
      const csvData = missingNames.map((name) => ({
        name: name,
      }));

      // Create write stream
      const writableStream = fs.createWriteStream(outputCSVPath);

      // Write to CSV
      stringify(csvData, {
        header: true,
        columns: {
          name: "Missing Names",
        },
      })
        .pipe(writableStream)
        .on("finish", resolve)
        .on("error", reject);
    });
  };

  try {
    // Get names from CSV
    const names = await parseCSV();

    // Find missing PDFs
    const missingNames = names.filter((name) => {
      if (!name) return false;
      const cleanName = name.trim().toLowerCase();
      return !pdfFiles.some((pdf) => pdf.toLowerCase().includes(cleanName));
    });

    // Save missing names to CSV
    await saveMissingToCSV(missingNames);

    console.log("\nMissing names have been saved to:", outputCSVPath);
    console.log(`Total missing PDFs: ${missingNames.length}`);

    // Print missing names in console
    console.log("\nMissing PDFs for:");
    missingNames.forEach((name) => {
      console.log(name);
    });

    return missingNames;
  } catch (error) {
    console.error("Error processing files:", error);
    throw error;
  }
}

// Run the verification
findMissingPDFs()
  .then(() => {
    console.log("Process completed!");
  })
  .catch((error) => {
    console.error("Process failed:", error);
  });
