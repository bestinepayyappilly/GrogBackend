const fs = require("fs");
const path = require("path");

// Copy the font loading function from server.js
const getBase64Font = (filepath) => {
  try {
    if (!fs.existsSync(filepath)) {
      console.warn(`Font not found: ${filepath}`);
      return "";
    }
    const font = fs.readFileSync(filepath);
    return `data:font/ttf;base64,${font.toString("base64")}`;
  } catch (error) {
    console.error(`Error reading font ${filepath}:`, error);
    return "";
  }
};

// Test font loading
console.log("Testing font loading...");

const oggTextMedium = getBase64Font(
  path.join(__dirname, "public/fonts/OggText-Medium.ttf")
);
const oggTextBold = getBase64Font(
  path.join(__dirname, "public/fonts/OggText-Bold.ttf")
);

console.log("OggText-Medium loaded:", oggTextMedium.length > 0 ? "YES" : "NO");
console.log("OggText-Bold loaded:", oggTextBold.length > 0 ? "YES" : "NO");

if (oggTextMedium.length > 0) {
  console.log("Medium font preview:", oggTextMedium.substring(0, 50) + "...");
}

// Test template replacement
let template = fs.readFileSync(__dirname + "/html/NFOInvite.html", "utf-8");

console.log("\nBefore replacement:");
console.log(
  "Contains {{oggTextMedium}}:",
  template.includes("{{oggTextMedium}}")
);
console.log("Contains {{oggTextBold}}:", template.includes("{{oggTextBold}}"));

template = template
  .replace("{{oggTextMedium}}", oggTextMedium)
  .replace("{{oggTextBold}}", oggTextBold);

console.log("\nAfter replacement:");
console.log(
  "Contains {{oggTextMedium}}:",
  template.includes("{{oggTextMedium}}")
);
console.log("Contains {{oggTextBold}}:", template.includes("{{oggTextBold}}"));
console.log(
  "Contains base64 font data:",
  template.includes("data:font/ttf;base64")
);

// Save test file
fs.writeFileSync("test-fonts-output.html", template);
console.log("\nTest HTML with fonts saved to test-fonts-output.html");
