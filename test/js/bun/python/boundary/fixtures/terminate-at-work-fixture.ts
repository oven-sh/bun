// Terminates workers whose Python is in the middle of something. `process.argv[2]` says of what. The program tells when it is there, so
// nothing depends on how long anything takes.
import { isMainThread, parentPort, workerData } from "node:worker_threads";

const programs: Record<string, string> = {
  // Its thread owes the other finalizers when it ends.
  "in a finalizer, with more to come": `
import threading
entered = threading.Event()
class D:
    def __del__(self):
        entered.set()
        while True: pass
def work():
    while True: [D() for _ in range(200)]
threading.Thread(target=work, daemon=True).start()
entered.wait()
tell()`,
  "two threads collect, and finalizers make more to finalize": `
import gc, threading
class D:
    def __del__(self): pass
class M:
    def __del__(self): [D() for _ in range(5)]
collected = threading.Semaphore(0)
def work():
    while True:
        [M() for _ in range(20)]
        gc.collect()
        collected.release()
for i in range(2): threading.Thread(target=work, daemon=True).start()
for i in range(4): collected.acquire()
tell()`,
};

if (isMainThread) {
  for (let round = 0; round < 3; ++round) {
    const worker = new Worker(import.meta.url, { workerData: process.argv[2] });
    const closed = new Promise(resolve => worker.addEventListener("close", resolve));
    await new Promise(resolve => worker.addEventListener("message", resolve, { once: true }));
    worker.terminate();
    await closed;
  }
  console.log("survived");
} else {
  // Not an import: only the worker is to start Python.
  const { exec, dict } = require("python:builtins");
  // Or it would end by itself, and could no longer be reached.
  setInterval(() => {}, 1000);
  exec(programs[workerData], dict([["tell", () => parentPort!.postMessage("there")]]));
}
