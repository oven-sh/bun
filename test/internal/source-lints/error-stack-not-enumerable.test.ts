import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// `stack` is not enumerable in V8, and not where JavaScriptCore defines it
// (ErrorInstance::materializeErrorInfoIfNeeded). The attributes of putDirect()
// default to 0, which is enumerable: Object.keys(), a spread, JSON.stringify()
// and util.inspect() then show the stack (#34259). So a native put of `stack`
// passes DontEnum.
//
// This checks half of what such a put needs. An ErrorInstance that still has
// the frames it captured formats them over the put on the first lookup of
// `stack`. The writer also materializes the error first, or drops its trace.
const putsStack = /\b(putDirect\w*)\s*\(\s*vm\s*,\s*(?:vm\.)?propertyNames->stack\s*,([^;]*)\)\s*;/g;

// `process.report.getReport().javascriptStack.stack` is a data property of a
// plain object. It is enumerable in Node too.
const enumerableOnPurpose = [
  "src/jsc/bindings/BunProcess.cpp: javascriptStack->putDirect(vm, vm.propertyNames->stack, stackArray, 0);",
  "src/jsc/bindings/BunProcessReportObjectWindows.cpp: javascriptStack->putDirect(vm, vm.propertyNames->stack, stackArray, 0);",
];

test("a native put of `stack` is not enumerable", async () => {
  const src = path.resolve(import.meta.dir, "..", "..", "..", "src");
  const violations: string[] = [];
  const allowed: string[] = [];
  let puts = 0;

  for (const glob of [new Glob("**/*.{h,cpp}"), new Glob("codegen/**/*.ts")]) {
    for await (const rel of glob.scan({ cwd: src })) {
      const file = path.join("src", rel).replaceAll("\\", "/");
      // The whole file, so that a call on several lines matches. Line comments go, line breaks stay.
      const code = readFileSync(path.join(src, rel), "utf8").replace(/\/\/.*$/gm, "");
      for (const match of code.matchAll(putsStack)) {
        puts++;
        if (match[2].includes("DontEnum")) continue;
        const receiver = code.slice(code.lastIndexOf("\n", match.index) + 1, match.index).trim();
        const statement = `${file}: ${receiver}${match[0]}`;
        if (enumerableOnPurpose.includes(statement)) allowed.push(statement);
        else violations.push(`${file}:${code.slice(0, match.index).split("\n").length}: ${receiver}${match[0]}`);
      }
    }
  }

  // With no put found, the puts moved or changed shape and this lint checks nothing.
  expect(puts).toBeGreaterThan(5);
  expect(allowed.sort()).toEqual(enumerableOnPurpose);
  expect(violations.sort()).toEqual([]);
});
