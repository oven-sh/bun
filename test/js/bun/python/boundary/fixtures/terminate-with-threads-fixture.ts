// Ends workers in which threads that Python started are running or waiting. `process.argv[2]` says how the workers end.
import { isMainThread, parentPort, workerData } from "node:worker_threads";

const threads = `
import os, select, socket, threading, time

def sleeps_briefly():
    while True: time.sleep(0.001)

def sleeps_long():
    time.sleep(3600)

def computes():
    n = 0
    while True: n += 1

def catches_everything():
    while True:
        try:
            while True: time.sleep(0.001)
        except BaseException:
            pass
        finally:
            ran_finally.append(1)

def waits_for_lock():
    lock.acquire()

def waits_for_event():
    threading.Event().wait()

def reads_pipe():
    os.read(pipe[0], 1)

def reads_into_buffer():
    pair[0].recv_into(bytearray(65536))

def accepts():
    listener.accept()

def selects():
    select.select([pipe[0]], [], [])

def joins():
    others[0].join()

ran_finally = []
lock = threading.Lock()
lock.acquire()
pipe = os.pipe()
pair = socket.socketpair()
listener = socket.socket()
listener.bind(("127.0.0.1", 0))
listener.listen()
functions = [sleeps_briefly, sleeps_long, computes, catches_everything, waits_for_lock, waits_for_event, reads_pipe,
             reads_into_buffer, accepts, selects, joins]
others = [threading.Thread(target=function, daemon=daemon) for function in functions]
for thread in others: thread.start()
# Until each of them is where it stays.
time.sleep(0.05)
`;

const countThreads = async () =>
  Number(
    /^Threads:\s*(\d+)/m.exec(
      await Bun.file("/proc/self/status")
        .text()
        .catch(() => ""),
    )?.[1] ?? 0,
  );

async function run(how: string) {
  const worker = new Worker(import.meta.url, { workerData: how });
  const closed = new Promise(resolve => worker.addEventListener("close", resolve));
  await new Promise(resolve => worker.addEventListener("message", resolve, { once: true }));
  if (how.startsWith("terminated")) worker.terminate();
  await closed;
}

if (isMainThread) {
  // The threads that the first worker brings about and that stay are not Python's.
  await run("no threads");
  const before = await countThreads();
  for (let round = 0; round < 3; ++round) await run(process.argv[2]);
  // Whatever is left of the threads has the time to do harm.
  const end = performance.now() + 100;
  while (performance.now() < end) await new Promise(resolve => setImmediate(resolve));
  const left = (await countThreads()) - before;
  console.log("survived", left < 11 ? "and the threads are gone" : `with ${left} more threads`);
} else {
  const { exec, dict } = require("python:builtins");
  // A worker that ends by itself waits for the threads that are no daemons, as a process does.
  if (workerData !== "no threads") exec(threads, dict([["daemon", workerData !== "terminated, not daemons"]]));
  parentPort!.postMessage("started");
}
