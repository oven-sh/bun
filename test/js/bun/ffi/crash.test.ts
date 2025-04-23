import { cc, CString } from "bun:ffi";
import source from "./crash.c" with { type: "file" };

const {
  symbols: { crash },
} = cc({ source, symbols: { crash: { args: [], returns: "pointer" } } });
console.log(new CString(crash()));
