// The timeout of node:vm ends a script whose Python waits, on the main thread, and the program goes on. `process.argv[2]` says for what it
// waits, `process.argv[3]` what another thread of Python's does meanwhile, if there is one. What is done "again and again" does not wait: the
// thread gives up the interpreter and takes it back all the time, and many timeouts come wherever they happen to come.
import vm from "node:vm";
import { dict, exec } from "python:builtins";

const waits: Record<string, string> = {
  "time.sleep()": `time.sleep(1000)`,
  "a lock": `lock.acquire()`,
  // With one thread it has not given up the interpreter, and it is the engine's signal that ends the sleep.
  "a lock, for a time": `lock.acquire(timeout=1000)`,
  "an event, for a time": `threading.Event().wait(1000)`,
  "queue.Queue.get(), for a time": `queue.Queue().get(timeout=1000)`,
  "queue.SimpleQueue.get(), for a time": `queue.SimpleQueue().get(timeout=1000)`,
  // (A collection of another thread's makes these two return.)
  "signal.pause()": `
    while True: signal.pause()`,
  "signal.sigwait()": `signal.sigwait({signal.SIGUSR2})`,
  "a sleep() of C": `
    while True: sleep(1000)`,
  "os.read()": `os.read(r, 1)`,
  "select.select()": `select.select([r], [], [])`,
  // The host's event loop turns while the main thread waits for a descriptor, and what it runs may wait in its turn.
  "os.read(), and again in what the event loop runs meanwhile": `os.read(r, 1)`,
  "open() of a FIFO": `open(fifo)`,
  "os.write() to a pipe that is full": `
    while True: os.write(w, bytes(65536))`,
  "os.write(), again and again": `
    while True: os.write(null, b".")`,
  "time.sleep(0), again and again": `
    while True: time.sleep(0)`,
  "select.select() for an instant, again and again": `
    while True: select.select([r], [], [], 0.0005)`,
};
const others: Record<string, string> = {
  "waits": `threading.Thread(target=threading.Event().wait, daemon=True).start()`,
  "computes": `
def compute():
    while True: pass
threading.Thread(target=compute, daemon=True).start()`,
};

const globals = dict([]);
exec(
  `
import ctypes, os, queue, select, signal, tempfile, threading, time
${others[process.argv[3]] ?? ""}
lock = threading.Lock()
lock.acquire()
r, w = os.pipe()
null = os.open(os.devnull, os.O_WRONLY)
sleep = ctypes.CDLL(None).sleep
directory = tempfile.TemporaryDirectory()
fifo = directory.name + "/fifo"
os.mkfifo(fifo)
def wait(): ${waits[process.argv[2]]}
def go_on():
    directory.cleanup()
    return sum(range(10))`,
  globals,
);

const wait = globals.get("wait");
const isNested = process.argv[2].endsWith("in what the event loop runs meanwhile");
const context = vm.createContext({ wait: isNested ? () => (setTimeout(wait, 1), wait()) : wait });
const isStress = process.argv[2].endsWith("again and again");
const outcomes = new Set<string>();
for (let i = 0; i < (isStress ? 300 : 1); ++i) {
  try {
    vm.runInContext("wait()", context, { timeout: isStress ? 1 + (i % 3) : 50 });
    outcomes.add("returned");
  } catch (error: any) {
    outcomes.add(error.code);
  }
}
console.log(...outcomes);
console.log(Number(globals.get("go_on")()));
process.exit(0);
