import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

process.stdin.setRawMode(true);

process.stdin.on("data", chunk => {
  const chunkStr = chunk.toString("utf-8");
  console.log("PARENT: received " + JSON.stringify(chunkStr));
  if (chunkStr.includes("\x03")) {
    console.log("PARENT: exiting.");
    process.stdin.pause();
    process.stdin.removeAllListeners();
    process.stdin.unref();
    console.log("%ready%");
  }

  if (!chunkStr.includes("\n") && !chunkStr.includes("\r")) {
    console.log("%ready%");
    return;
  }
  console.log("PARENT: pause");
  process.stdin.pause();
  process.stdin.setRawMode(false);

  const childScript = join(__dirname, "child-reader.mjs");
  const child = spawn(process.execPath, [childScript], { stdio: "inherit" });

  child.on("exit", code => {
    console.log("PARENT: child exited with code " + code + ". reading again.");
    process.stdin.resume();
    process.stdin.setRawMode(true);
    console.log("%ready%");
  });
});

console.log("PARENT: reading");

console.log("%ready%");
