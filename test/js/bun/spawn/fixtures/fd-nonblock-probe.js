// Prints "<fd>:blocking" or "<fd>:nonblocking" for each fd number in argv.
// The flag is read before anything writes, so this process cannot change it.
// Must not touch process.stdout/process.stderr/process.send: those set
// O_NONBLOCK on their own fds.
import { dlopen } from "bun:ffi";
import { existsSync, readFileSync } from "node:fs";

let isNonblocking;
if (existsSync("/proc/self/fdinfo")) {
  isNonblocking = fd => {
    const flags = readFileSync(`/proc/self/fdinfo/${fd}`, "utf8").match(/^flags:\s*([0-7]+)/m)[1];
    return (parseInt(flags, 8) & 0o4000) !== 0;
  };
} else {
  // F_GETFL is 3 everywhere; O_NONBLOCK is 4 on the BSDs and macOS.
  const libc = process.platform === "darwin" ? "libSystem.B.dylib" : "libc.so.7";
  const { fcntl } = dlopen(libc, {
    fcntl: { args: ["i32", "i32", "i32"], returns: "i32" },
  }).symbols;
  isNonblocking = fd => (fcntl(fd, 3, 0) & 4) !== 0;
}

const out = process.argv
  .slice(2)
  .map(arg => `${arg}:${isNonblocking(Number(arg)) ? "nonblocking" : "blocking"}`)
  .join(" ");
console.log(out);
