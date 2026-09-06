// Prints "<fd>:blocking" or "<fd>:nonblocking" for each fd number in argv.
// The flag is read before anything writes, so this process cannot change it.
// Must not touch process.stdout/process.stderr/process.send: those set
// O_NONBLOCK on their own fds.
import { dlopen } from "bun:ffi";
import { readFileSync } from "node:fs";

let isNonblocking;
if (process.platform === "linux") {
  isNonblocking = fd => {
    const flags = readFileSync(`/proc/self/fdinfo/${fd}`, "utf8").match(/^flags:\s*([0-7]+)/m)[1];
    return (parseInt(flags, 8) & 0o4000) !== 0;
  };
} else {
  const { fcntl } = dlopen("libSystem.B.dylib", {
    fcntl: { args: ["i32", "i32", "i32"], returns: "i32" },
  }).symbols;
  const F_GETFL = 3;
  const O_NONBLOCK = 4;
  isNonblocking = fd => (fcntl(fd, F_GETFL, 0) & O_NONBLOCK) !== 0;
}

const out = process.argv
  .slice(2)
  .map(arg => `${arg}:${isNonblocking(Number(arg)) ? "nonblocking" : "blocking"}`)
  .join(" ");
console.log(out);
