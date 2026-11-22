import { dlopen } from "bun:ffi";
import { observe } from "./evaluate";

const { SETLOCALE } = process.env;
if (SETLOCALE) {
  const libc = dlopen("libc.so.6", { setlocale: { args: ["i32", "cstring"], returns: "cstring" } });
  const LC_CTYPE = 0;
  const set = String(libc.symbols.setlocale(LC_CTYPE, Buffer.from(SETLOCALE + "\0")));
  libc.close();
  if (set !== SETLOCALE) throw new Error(`setlocale() returned ${set}`);
}

console.log(JSON.stringify((await Bun.stdin.json()).map(observe)));
