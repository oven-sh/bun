import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// JSDOMOperation.h redefines the name with a macro, so without the include the unified bundle decides whether the error has a `code`.
test("callers of createNotEnoughArgumentsError include JSDOMOperation.h", () => {
  const src = path.resolve(import.meta.dir, "..", "..", "..", "src");
  const callers = [...new Glob("**/*.cpp").scanSync({ cwd: src })]
    .map(file => file.replaceAll("\\", "/"))
    // Never bundled (`noUnifyDirs`), and their errors have no `code`.
    .filter(file => !file.startsWith("jsc/bindings/webcore/streams/"))
    .map(file => [file, readFileSync(path.join(src, file), "utf8")])
    .filter(([, source]) => source.includes("createNotEnoughArgumentsError("));

  expect(callers.length).toBeGreaterThan(0);
  expect(
    callers.filter(([, source]) => !/^#include "JSDOMOperation\w*\.h"/m.test(source)).map(([file]) => file),
  ).toEqual([]);
});
