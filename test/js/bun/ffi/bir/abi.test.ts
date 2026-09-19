import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { compileFor, runFixtures } from "./run-fixtures";

// Calling conventions: what is sent is what arrives, between C functions, between C and the C library, and between
// C and JavaScript.
runFixtures("abi");

// A layout is a matter of the target and not of where the compiler runs, so Microsoft's are checked everywhere: the
// fixture that Windows runs is all static assertions, and with one more that fails, at its end, that one is the only
// thing there is to say about it.
test("Microsoft's layouts hold when compiling for Windows on any system", async () => {
  const source = readFileSync(
    join(import.meta.dir, "fixtures/structs-and-abi/required-alignment-against-packing-on-windows.c"),
    "utf8",
  );
  using dir = tempDir("bir-windows-layouts", {
    "layouts.c": source + '_Static_assert(0, "every layout above held");\n',
  });
  const line = source.split("\n").length;
  const said = (await compileFor(String(dir), "layouts.c", "bun-windows-x64")).replaceAll(String(dir) + sep, "");
  expect(said).toContain(`error: static assertion failed: every layout above held\n    at layouts.c:${line}:1\n`);
});
