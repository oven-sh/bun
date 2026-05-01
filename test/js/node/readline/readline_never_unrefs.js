import readline from "readline/promises";

process.stdin.on("pause", () => console.log("[ ] on pause"));
process.stdin.on("resume", () => console.log("[ ] on resume"));

const rl1 = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
if (process.argv.includes("--pass")) await Bun.sleep(1);
rl1.close();
