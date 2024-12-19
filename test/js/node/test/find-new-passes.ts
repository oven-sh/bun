import path from "path";
import fs from "fs";
import { spawn } from "child_process";

const localDir = path.resolve(import.meta.dirname, "./parallel");
const upstreamDir = path.resolve(import.meta.dirname, "../../../node.js/upstream/test/parallel");

const localFiles = fs.readdirSync(localDir);
const upstreamFiles = fs.readdirSync(upstreamDir);

const newFiles = upstreamFiles.filter((file) => !localFiles.includes(file));

process.on('SIGTERM', () => {
  console.log("SIGTERM received");
});
process.on('SIGINT', () => {
  console.log("SIGINT received");
});

const stdin = process.stdin;
if (stdin.isTTY) {
  stdin.setRawMode(true);
  stdin.on('data', (data) => {
    if (data[0] === 0x03) {
      stdin.setRawMode(false);
      console.log("Cancelled");
      process.exit(0);
    }
  });
}
process.on('exit', () => {
  if (stdin.isTTY) {
    stdin.setRawMode(false);
  }
});

for (const file of newFiles) {
  await new Promise<void>((resolve, reject) => {
    // Run with a timeout of 5 seconds
    const proc = spawn("bun-debug", ["run", path.join(upstreamDir, file)], {
      timeout: 5000,
      stdio: "inherit",
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
      },
    });

    proc.on("error", (err) => {
      console.error(err);
    });

    proc.on("exit", (code) => {
      if (code === 0) {
        console.log(`New Pass: ${file}`);
        fs.appendFileSync("new-passes.txt", file + "\n");
      }
      resolve();
    });
  });
}
