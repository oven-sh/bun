import { dlopen, ptr } from "bun:ffi";

var lazyMkfifo;
export function mkfifo(path: string, permissions: number = 0o666): void {
  if (!lazyMkfifo) {
    const suffix = process.platform === "darwin" ? "dylib" : "so.6";
    lazyMkfifo = dlopen(`libc.${suffix}`, {
      mkfifo: {
        args: ["ptr", "i32"],
        returns: "i32",
      },
    }).symbols.mkfifo;
  }

  const buf = new Uint8Array(Buffer.byteLength(path) + 1);
  new TextEncoder().encodeInto(path, buf);
  const rc = lazyMkfifo(ptr(buf), permissions);

  if (rc < 0) {
    throw new Error(`mkfifo failed`);
  }
}
