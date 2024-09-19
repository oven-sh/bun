import { cc } from "bun:ffi";
import fixture from "./cc-fixture.c" with { type: "file" };
const {
  symbols: { napi_main, main },
} = cc({
  source: fixture,
  define: {
    "HAS_MY_DEFINE": '"my value"',
  },

  symbols: {
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
