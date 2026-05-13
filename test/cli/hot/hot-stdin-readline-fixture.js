import readline from "node:readline";

// Survives reloads (--hot keeps the global object).
globalThis.__reloadCount ??= 0;
globalThis.__reloadCount++;
const myLoad = globalThis.__reloadCount;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// One listener each after createInterface; if old listeners leaked across
// the reload these would be 2, 3, ... on subsequent loads.
console.log(
  "LISTENERS",
  myLoad,
  process.stdin.listenerCount("data"),
  process.stdin.listenerCount("error"),
  process.stdin.listenerCount("end"),
  process.stdout.listenerCount("resize"),
);

rl.on("line", line => {
  // Capture myLoad so a leaked handler from a previous load is visible
  // as "ECHO <old> ..." in the output.
  console.log("ECHO", myLoad, line);
});
