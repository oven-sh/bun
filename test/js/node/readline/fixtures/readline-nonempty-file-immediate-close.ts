import readline from "readline";
import fs from "fs";
import path from "path";

const nonEmptyFile = fs.createReadStream(path.resolve(__dirname, "not-empty.txt"), "utf8");

const rl1 = readline.createInterface({
  input: nonEmptyFile,
  output: process.stdout,
});

rl1.close();
