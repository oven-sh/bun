import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
let parentCount = 0;

process.stdin.setRawMode(true);

process.stdin.on("data", chunk => {
  if (chunk[0] === 13 || chunk[0] === 10) {
    console.log("PARENT: pause");
    process.stdin.pause();
    process.stdin.setRawMode(false);

    const childScript = join(__dirname, "child-reader.mjs");
    const child = spawn(process.execPath, [childScript], { stdio: "inherit" });

    child.on("exit", () => {
      console.log("PARENT:", parentCount);
      if (parentCount > 0) process.exitCode = 1;
      process.stdin.pause();
      process.stdin.removeAllListeners();
      process.stdin.unref();
    });
  } else {
    parentCount++;
    console.log("PARENT:", parentCount);
  }
});

console.log("Press Enter:");
