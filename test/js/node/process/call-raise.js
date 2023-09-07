import { dlopen } from "bun:ffi";

var lazyRaise;
export function raise(signal) {
  if (!lazyRaise) {
    const suffix = process.platform === "darwin" ? "dylib" : "so.6";
    lazyRaise = dlopen(`libc.${suffix}`, {
      raise: {
        args: ["int"],
        returns: "int",
      },
    }).symbols.raise;
  }
  lazyRaise(signal);
}
