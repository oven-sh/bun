import { cc } from "bun:ffi";
import assert from "node:assert";

assert.ok(process.send);

cc({
  source: "./example.c",
  symbols: {
    foo: { args: [], returns: "void" },
  },
});

process.send("hej");

while (true);
