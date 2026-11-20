import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// hwy::ChosenTarget::GetIndex() has the list of targets of the file that it is compiled in.
test("a file that configures Highway for itself does not compile unless GetIndex() is inlined", () => {
  const bindings = path.resolve(import.meta.dir, "../../../src/jsc/bindings");
  const read = (file: string) => readFileSync(path.join(bindings, file), "utf8");
  const files = [...new Glob("**/*.{cpp,h}").scanSync(bindings)].filter(file =>
    /^\s*#\s*(define|undef)\s+HWY_(?!TARGET_INCLUDE\b)/m.test(read(file)),
  );

  expect(files).toContain("highway_png.cpp");
  expect(files.filter(file => !/^#ifndef __OPTIMIZE__\n#error /m.test(read(file)))).toEqual([]);
});
