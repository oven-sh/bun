// Prints "<fd>:blocking" or "<fd>:nonblocking" for each fd in argv, using fs.writeSync so this process sets no flags itself.
import { dlopen } from "bun:ffi";
import { existsSync, readFileSync, writeSync } from "node:fs";

let isNonblocking;
if (existsSync("/proc/self/fdinfo")) {
  isNonblocking = fd =>
    (parseInt(readFileSync(`/proc/self/fdinfo/${fd}`, "utf8").match(/^flags:\s*([0-7]+)/m)[1], 8) & 0o4000) !== 0;
} else {
  const { fcntl } = dlopen(process.platform === "darwin" ? "libSystem.B.dylib" : "libc.so.7", {
    fcntl: { args: ["i32", "i32", "i32"], returns: "i32" },
  }).symbols;
  isNonblocking = fd => (fcntl(fd, 3 /* F_GETFL */, 0) & 4) /* O_NONBLOCK */ !== 0;
}

writeSync(
  1,
  process.argv
    .slice(2)
    .map(fd => `${fd}:${isNonblocking(Number(fd)) ? "nonblocking" : "blocking"}`)
    .join(" ") + "\n",
);
