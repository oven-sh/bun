// https://github.com/oven-sh/bun/issues/27380
// Map.prototype.getOrInsert / getOrInsertComputed and
// WeakMap.prototype.getOrInsert / getOrInsertComputed are implemented at
// runtime (TC39 proposal-upsert, Stage 3) but were missing from bun-types,
// so TypeScript reported ts(2339).
//
// The full conflict-free type integration (including merging with
// lib.esnext.collection.d.ts / lib.dom.d.ts) is covered by
// test/integration/bun-types/bun-types.test.ts via fixture/map.ts.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

test("bun-types declares getOrInsert / getOrInsertComputed on Map and WeakMap", () => {
  const path = join(import.meta.dir, "../../../packages/bun-types/globals.d.ts");
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);

  const found = {
    Map: new Set<string>(),
    WeakMap: new Set<string>(),
  };

  source.forEachChild(node => {
    if (!ts.isInterfaceDeclaration(node)) return;
    const name = node.name.text;
    if (name !== "Map" && name !== "WeakMap") return;
    for (const member of node.members) {
      if (ts.isMethodSignature(member) && member.name && ts.isIdentifier(member.name)) {
        found[name].add(member.name.text);
      }
    }
  });

  expect([...found.Map]).toEqual(expect.arrayContaining(["getOrInsert", "getOrInsertComputed"]));
  expect([...found.WeakMap]).toEqual(expect.arrayContaining(["getOrInsert", "getOrInsertComputed"]));
});

test("Map.prototype.getOrInsert", () => {
  const map = new Map<string, number>();

  expect(map.getOrInsert("a", 1)).toBe(1);
  expect(map.get("a")).toBe(1);
  // existing entry is returned, not overwritten
  expect(map.getOrInsert("a", 2)).toBe(1);
  expect(map.get("a")).toBe(1);
});

test("Map.prototype.getOrInsertComputed", () => {
  const map = new Map<string, number>();
  let calls = 0;

  expect(
    map.getOrInsertComputed("key", k => {
      calls++;
      return k.length;
    }),
  ).toBe(3);
  expect(calls).toBe(1);
  expect(map.get("key")).toBe(3);

  // callback is not invoked when the key already exists
  expect(
    map.getOrInsertComputed("key", () => {
      calls++;
      return 999;
    }),
  ).toBe(3);
  expect(calls).toBe(1);
});

test("WeakMap.prototype.getOrInsert / getOrInsertComputed", () => {
  const weak = new WeakMap<object, string>();
  const key = {};

  expect(weak.getOrInsert(key, "light")).toBe("light");
  expect(weak.getOrInsert(key, "dark")).toBe("light");

  let calls = 0;
  const key2 = {};
  expect(
    weak.getOrInsertComputed(key2, k => {
      calls++;
      expect(k).toBe(key2);
      return "computed";
    }),
  ).toBe("computed");
  expect(calls).toBe(1);
  expect(
    weak.getOrInsertComputed(key2, () => {
      calls++;
      return "never";
    }),
  ).toBe("computed");
  expect(calls).toBe(1);
});
