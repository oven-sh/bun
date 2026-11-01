// Prints process.env.UV_THREADPOOL_SIZE and how many threads the pool has, once $BUSY_THREADS of them are each in a
// read. A thread that takes a task first starts the next thread if the pool may have one more, so a pool that may
// have more than $BUSY_THREADS has more by then. The directory it runs in holds more FIFOs named "fifo.." than that.
import { closeSync, constants, openSync, promises, readdirSync, readFileSync } from "node:fs";

export async function print() {
  const unread = new Set(readdirSync(".").filter(name => name.startsWith("fifo")));
  // A read of a FIFO keeps its thread until the FIFO was opened for writing and closed again.
  const reads = Array.from(unread, fifo => promises.readFile(fifo));
  // A FIFO opens for writing without a wait only while a thread reads it.
  const open = () => {
    const writers = [];
    for (const fifo of unread) {
      try {
        writers.push(openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK));
        unread.delete(fifo);
      } catch (error) {
        if (error.code !== "ENXIO") throw error;
      }
    }
    return writers;
  };
  const held = [];
  // A pool with too few threads never gets there: its count is printed after two seconds.
  const deadline = Date.now() + 2000;
  while (held.push(...open()) < +process.env.BUSY_THREADS && Date.now() < deadline) Bun.sleepSync(1);

  let threads = 0;
  for (const tid of readdirSync("/proc/self/task")) {
    try {
      if (readFileSync(`/proc/self/task/${tid}/comm`, "utf8").startsWith("Bun Pool")) threads++;
    } catch {}
  }
  console.log(JSON.stringify({ UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE, threads }));

  held.forEach(closeSync);
  while (unread.size) {
    open().forEach(closeSync);
    Bun.sleepSync(1);
  }
  await Promise.all(reads);
}
