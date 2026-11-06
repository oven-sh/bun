// Terminates a worker that an error has ended and that is running what Python runs at exit. `process.argv[2]` says which part of that.
// (One that ends for want of anything to do can no longer be reached by then.)
import { isMainThread, parentPort, workerData } from "node:worker_threads";

const programs: Record<string, string> = {
  atexit: `
import atexit
atexit.register(last)
`,
  threading: `
import threading
threading._register_atexit(last)
`,
  finalizer: `
class Kept:
    def __del__(self): last()
kept = Kept()
`,
  flush: `
import sys
class Output:
    closed = False
    def write(self, text): return len(text)
    def flush(self): last()
sys.stdout = Output()
`,
  // It is sys.unraisablehook that does not return. What would come next says so on stderr.
  "atexit, which raises": `
import atexit, os, sys
sys.unraisablehook = lambda args: last()
atexit.register(os.write, 2, b"the next callback was called\\n")
@atexit.register
def first(): raise KeyError("atexit")
`,
  "threading, which raises": `
import atexit, os, sys, threading
sys.unraisablehook = lambda args: last()
atexit.register(os.write, 2, b"the callbacks of atexit were called\\n")
@threading._register_atexit
def first(): raise KeyError("threading")
`,
  "flush, which raises": `
import os, sys
sys.unraisablehook = lambda args: last()
class Output:
    closed = False
    def write(self, text): return len(text)
    def flush(self): raise KeyError("flush")
class Errors(Output):
    def flush(self): os.write(2, b"sys.stderr was flushed\\n")
sys.stdout = Output()
sys.stderr = Errors()
`,
};

if (isMainThread) {
  const worker = new Worker(import.meta.url, { workerData: process.argv[2] });
  const closed = new Promise(resolve => worker.addEventListener("close", resolve));
  worker.addEventListener("error", event => event.preventDefault());
  await new Promise(resolve => worker.addEventListener("message", resolve, { once: true }));
  worker.terminate();
  await closed;
  console.log("closed");
} else {
  const { exec, dict } = require("python:builtins");
  const globals = dict([["tell", () => parentPort!.postMessage("at exit")]]);
  exec(
    `
def last():
    tell()
    while True: pass
` + programs[workerData],
    globals,
  );
  // For the finalizer: something other than a module holds the object.
  (globalThis as any).kept = globals;
  throw new Error("the end of the worker");
}
