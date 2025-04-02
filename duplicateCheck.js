const fs = require("fs");
const { parse } = require("csv-parse");
const { stringify } = require("csv-stringify");

async function findDuplicateNames() {
  const csvFilePath = "./checkNames.csv";
  const outputCSVPath = "./duplicate_names.csv";

  const parseCSV = () => {
    return new Promise((resolve, reject) => {
      const nameCount = new Map();
      const duplicates = [];
      const nameDetails = new Map(); // Store all instances of a name with their usernames

      fs.createReadStream(csvFilePath)
        .pipe(
          parse({
            columns: true,
            skip_empty_lines: true,
          })
        )
        .on("data", (row) => {
          const name = row.name.trim();
          const username = row.student_username;

          // Store name details
          if (nameDetails.has(name)) {
            nameDetails.get(name).push(username);
          } else {
            nameDetails.set(name, [username]);
          }

          // Count occurrences
          if (nameCount.has(name)) {
            nameCount.set(name, nameCount.get(name) + 1);
            if (nameCount.get(name) === 2) {
              duplicates.push({
                name: name,
                count: nameCount.get(name),
                usernames: nameDetails.get(name).join(", "),
              });
            }
          } else {
            nameCount.set(name, 1);
          }
        })
        .on("end", () => {
          resolve(duplicates);
        })
        .on("error", reject);
    });
  };

  const saveDuplicatesToCSV = (duplicates) => {
    return new Promise((resolve, reject) => {
      const writableStream = fs.createWriteStream(outputCSVPath);

      stringify(duplicates, {
        header: true,
        columns: {
          name: "Name",
          count: "Number of Occurrences",
          usernames: "Student Usernames",
        },
      })
        .pipe(writableStream)
        .on("finish", resolve)
        .on("error", reject);
    });
  };

  try {
    const duplicates = await parseCSV();

    if (duplicates.length > 0) {
      await saveDuplicatesToCSV(duplicates);
      console.log("\nDuplicate names found:");
      duplicates.forEach((dup) => {
        console.log(`Name: ${dup.name}`);
        console.log(`Appears: ${dup.count} times`);
        console.log(`Student Usernames: ${dup.usernames}`);
        console.log("-------------------");
      });
      console.log(`\nResults saved to: ${outputCSVPath}`);
    } else {
      console.log("No duplicate names found in the CSV file.");
    }

    return duplicates;
  } catch (error) {
    console.error("Error processing file:", error);
    throw error;
  }
}

// Run the script
findDuplicateNames()
  .then(() => {
    console.log("Process completed!");
  })
  .catch((error) => {
    console.error("Process failed:", error);
  });
