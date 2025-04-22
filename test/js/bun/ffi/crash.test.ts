import { cc } from "bun:ffi";
import source from "./crash.c" with { type: "file" };

const {
  symbols: { crash },
} = cc({ source, symbols: { crash: { args: [], returns: "void" } } });
crash();
