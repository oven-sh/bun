import { writeFileSync, writeFile } from "node:fs";

process.exitCode = 1;
let input = process.argv[2];

if (input === "1") {
  input = 1;
} else if (input === "2") {
  input = 2;
}

writeFileSync(input, "Hello World!\n");
writeFile(input, "Hello World!\n", () => {
  process.exitCode = 0;
});
