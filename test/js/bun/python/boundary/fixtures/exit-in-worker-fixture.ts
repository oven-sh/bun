// Python exits, in a worker or in the main program: `process.argv[2]` says where, the variable HOW of the environment how. Prints what runs
// before the end, and for a worker the status.
import { readFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { isMainThread, Worker } from "node:worker_threads";

const program = join(import.meta.dir, "exit-in-worker.py");
const where = process.argv[2];
if (isMainThread && where.startsWith("a worker")) {
  const worker = new Worker(where === "a worker that is a module of Python" ? program : import.meta.filename, {
    argv: [where],
  });
  worker.on("exit", code => writeSync(1, `closed with ${code}\n`));
} else {
  // Not an import: only this side is to start Python.
  const { dict, exec } = await import("python:builtins");
  const globals = dict([]);
  process.on("exit", code => {
    writeSync(1, `listener of exit: ${code}\n`);
    globals.get("exits_again", () => {})();
  });
  exec(readFileSync(program, "utf8"), globals);
  writeSync(1, "went on\n");
}
