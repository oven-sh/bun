import { expect, test } from "bun:test";
import { parseNativeLoads } from "../../../src/codegen/builtins/collect-registrations.ts";
import { Problems } from "../../../src/codegen/builtins/declarations.ts";

function exportsReadBy(statement: string) {
  const problems = new Problems();
  const text = `void f(Zig::GlobalObject* realm)\n{\n    ${statement}\n}\n`;
  const sites = parseNativeLoads(text, "src/jsc/bindings/F.cpp", problems);
  return { exports: sites.map(site => site.exports), problems: problems.lines.length };
}

test("a site that lists no export may read any", () => {
  expect(exportsReadBy(`return BUN_REQUIRE_INTERNAL_MODULE(realm, NodeTimers, "node:timers");`)).toEqual({
    exports: [null],
    problems: 0,
  });
});

test("a site reads the exports that it lists", () => {
  expect(exportsReadBy(`return BUN_REQUIRE_INTERNAL_MODULE(realm, NodeTimers, "node:timers", "active"_s);`)).toEqual({
    exports: [["active"]],
    problems: 0,
  });
});

test("a site that only loads the module reads none", () => {
  expect(exportsReadBy(`BUN_LOAD_INTERNAL_MODULE(realm, NodeTimers, "node:timers");`)).toEqual({
    exports: [[]],
    problems: 0,
  });
  expect(exportsReadBy(`BUN_LOAD_INTERNAL_MODULE(realm, NodeTimers, "node:timers", "active"_s);`)).toEqual({
    exports: [],
    problems: 1,
  });
});
