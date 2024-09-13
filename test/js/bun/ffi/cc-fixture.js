import { cc } from "bun:ffi";
import fixture from "./cc-fixture.c";
const {
  symbols: { main },
} = cc({
  source: fixture,
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
