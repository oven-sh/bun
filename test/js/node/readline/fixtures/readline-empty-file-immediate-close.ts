import readline from "readline";
import fs from "fs";
import path from "path";

const emptyFile = fs.createReadStream(path.resolve(__dirname, "empty.txt"), "utf8");

const rl1 = readline.createInterface({
  input: emptyFile,
  output: process.stdout,
});

rl1.close();
