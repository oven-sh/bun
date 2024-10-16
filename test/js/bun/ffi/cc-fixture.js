import { cc } from "bun:ffi";
import fixture from "./cc-fixture.c" with { type: "file" };
let bytes = new Uint8Array(64);
bytes[bytes.length - 1] = 42;

const {
  symbols: { napi_main, main, lastByte },
} = cc({
  source: fixture,
  define: {
    "HAS_MY_DEFINE": '"my value"',
  },

  symbols: {
    "lastByte": {
      args: ["ptr", "uint64_t"],
      returns: "uint8_t",
    },
    "napi_main": {
      args: ["napi_env"],
      returns: "napi_value",
    },
    "main": {
      args: [],
      returns: "int",
    },
  },
});

if (main() !== 42) {
  throw new Error("main() !== 42");
}

if (napi_main(null) !== "Hello, Napi!") {
  throw new Error("napi_main() !== Hello, Napi!");
}

if (lastByte(bytes, bytes.byteLength) !== 42) {
  throw new Error("lastByte(bytes, bytes.length) !== 42");
}
