const Papa = require("papaparse");
const fs = require("fs");
const Handlebars = require("handlebars");

// Read and parse CSV
const csvContent = fs.readFileSync("test-book-orders.csv", "utf-8");
let CSVData = [];

Papa.parse(csvContent, {
  header: true,
  dynamicTyping: true,
  skipEmptyLines: true,
  complete: (result) => {
    CSVData = result.data;
    console.log("CSV Data loaded:", CSVData.length, "rows");
    console.log("First row:", CSVData[0]);
    console.log("Customer Name field:", CSVData[0]["Customer Name"]);

    // Test mapping for typeId 21
    const typeId = 21;
    const template = fs.readFileSync("html/NFOInvite.html", "utf-8");

    const mappedRow = {
      ...CSVData[0],
      customerName: CSVData[0]["Customer Name"],
    };

    console.log("Mapped row customerName:", mappedRow.customerName);

    // Test template compilation
    const compiled = Handlebars.compile(template);
    const html = compiled(mappedRow);

    console.log("HTML generation successful");
    console.log(
      "HTML contains customer name:",
      html.includes(mappedRow.customerName)
    );

    // Save test HTML for inspection
    fs.writeFileSync("debug-test.html", html);
    console.log("Test HTML saved to debug-test.html");
  },
});
