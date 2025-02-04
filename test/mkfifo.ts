import { dlopen, ptr } from "bun:ffi";
import { libcPathForDlopen } from "harness";

var lazyMkfifo: any;
export function mkfifo(path: string, permissions: number = 0o666): void {
  if (!lazyMkfifo) {
    lazyMkfifo = dlopen(libcPathForDlopen(), {
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
