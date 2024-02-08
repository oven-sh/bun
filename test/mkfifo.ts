import { dlopen, ptr } from "bun:ffi";
import { isWindows } from "harness";
import { join } from "path";

var ffiFunc: any;
export function mkfifo(pipename: string, permissions: number = 0o666): string {
  if (isWindows) {
    if (!ffiFunc) {
      ffiFunc = dlopen("kernel32.dll", {
        CreateNamedPipeA: {
          args: ["ptr", "i32", "i32", "i32", "i32", "i32", "i32", "ptr"],
          returns: "ptr",
        },
      }).symbols.CreateNamedPipeA;
    }

    const path = `\\\\.\\pipe\\${pipename}`;
    const buf = new Uint8Array(Buffer.byteLength(path) + 1);
    new TextEncoder().encodeInto(path, buf);

    const rc = ffiFunc(ptr(buf), 0x00000003, 0, 255, 1024, 1024, 0, null);
    // todo this check probably doesn't quite do the right thing
    if (rc === 18446744073709551615) {
      throw new Error(`CreateNamedPipeA failed`);
    }

    return path;

    return path;
  } else {
    if (!ffiFunc) {
      const suffix = process.platform === "darwin" ? "dylib" : "so.6";
      ffiFunc = dlopen(`libc.${suffix}`, {
        mkfifo: {
          args: ["ptr", "i32"],
          returns: "i32",
        },
      }).symbols.mkfifo;
    }

    const path = join("/tmp", pipename);
    const buf = new Uint8Array(Buffer.byteLength(path) + 1);
    new TextEncoder().encodeInto(path, buf);
    const rc = ffiFunc(ptr(buf), permissions);

    if (rc < 0) {
      throw new Error(`mkfifo failed`);
    }

    return path;
  }
}
