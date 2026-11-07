// A call of the system waits, with memory of JS's to read into or to write from. A signal interrupts it, and the handler calls code of JS's that takes the memory away. The call is then
// made again.
import {
  call,
  drain,
  feed,
  fill,
  install,
  install_audit_hook,
  keep_a_thread,
  left_in_the_pipe,
} from "./memory-taken-away.py";
const [name, how, thread] = process.argv.slice(2);
const size = 4096;
const writes = name.includes("write");
let buffer: ArrayBuffer | SharedArrayBuffer = new ArrayBuffer(size);
if (how === "made shorter") buffer = new ArrayBuffer(size, { maxByteLength: size });
if (how === "made longer") buffer = new SharedArrayBuffer(size, { maxByteLength: 16 * size });
const memory = new WebAssembly.Memory({ initial: 1, maximum: 16 });
if (how === "that of WebAssembly, which grows") buffer = memory.buffer;
// (Left alone, it is one that has no ArrayBuffer until Python looks at it.)
const array =
  how === "left alone" ? new Uint8Array(size) : new Uint8Array(buffer, 0, how === "made shorter" ? undefined : size);
// What comes to lie where the memory was.
const later: Uint8Array[] = [];
let refused = "";
install(() => {
  try {
    if (how === "moved and freed") {
      (buffer as ArrayBuffer).transfer();
      for (let i = 0; i < 5; i++) Bun.gc(true);
      for (let i = 0; i < 200; i++) later.push(new Uint8Array(size));
    } else if (how === "made shorter") (buffer as ArrayBuffer).resize(16);
    else if (how === "made longer") (buffer as SharedArrayBuffer).grow(16 * size);
    else if (how === "that of WebAssembly, which grows") memory.grow(1);
  } catch (error) {
    refused = ` (${(error as Error).name})`;
  }
  if (writes) drain();
  else feed(name.includes("a part") ? 1024 : size);
});
if (thread === "beside another thread") keep_a_thread();
if (name === "os.setxattr()") install_audit_hook();
if (writes) fill();
const sender = Bun.spawn(["sh", "-c", `while kill -USR1 ${process.pid} 2>/dev/null; do sleep 0.01; done`], {
  stdio: ["ignore", "ignore", "ignore"],
});
const result = String(call(name, array));
sender.kill();
console.log(result + refused);
// How long the array is now; which of its bytes have been written; in how many of the others something has been written; what has got into the pipe and stayed there.
const first = array.length ? array.indexOf(0xee) : -1;
const zeros = Buffer.alloc(size);
console.log(
  array.length,
  first < 0 ? "none" : `${first} to ${array.lastIndexOf(0xee)}`,
  later.filter(other => !zeros.equals(other)).length,
  Number(left_in_the_pipe()),
);
process.exit(0);
