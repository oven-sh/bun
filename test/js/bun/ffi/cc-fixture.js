import { cc } from "bun:ffi";
import fixture from "./cc-fixture.c" with { type: "file" };
const {
  symbols: { main },
} = cc({
  source: fixture,
  define: {
    "HAS_MY_DEFINE": '"my value"',
  },
  flags: ["-l/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"],
  symbols: {
    "main": {
      args: [],
      returns: "int",
    },
  },
});

if (main() !== 42) {
  throw new Error("main() !== 42");
}
