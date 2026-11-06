// Scripts of node:vm that open a file again and again are ended by their timeouts, wherever they happen to be: in open(), in a method of the
// file, in its close(), in its finalizer. Prints how many descriptors are still open on the file once the collector has had a look.
import vm from "node:vm";
import { dict, exec } from "python:builtins";

const bodies: Record<string, string> = {
  "a file that nothing refers to": `open(path, "rb", buffering=0).read()`,
  "a file in a variable": `f = open(path, "rb", buffering=0)`,
  "a file of a with statement": `
        with open(path, "rb", buffering=0) as f: f.read()`,
  "a buffered file of a with statement": `
        with open(path, "rb") as f: f.read()`,
  "a text file of a with statement": `
        with open(path, encoding="latin-1") as f: f.read()`,
};

const globals = dict([]);
exec(
  `
import gc, os, tempfile
descriptor, path = tempfile.mkstemp()
os.write(descriptor, bytes(1 << 12))
os.close(descriptor)
def work():
    while True: ${bodies[process.argv[2]]}
def still_open():
    gc.collect()
    gc.collect()
    file = os.stat(path)
    count = 0
    for descriptor in os.listdir("/proc/self/fd" if os.path.exists("/proc/self/fd") else "/dev/fd"):
        try: other = os.fstat(int(descriptor))
        except OSError: continue
        count += (other.st_dev, other.st_ino) == (file.st_dev, file.st_ino)
    return count`,
  globals,
);

const context = vm.createContext({ work: globals.get("work") });
let ended = 0;
for (let i = 0; i < 40; ++i) {
  try {
    vm.runInContext("work()", context, { timeout: 1 + (i % 7) });
  } catch (error: any) {
    if (error.code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") throw error;
    ++ended;
  }
}
console.log(ended, "ended,", Number(globals.get("still_open")()), "still open");
exec("os.unlink(path)", globals);
