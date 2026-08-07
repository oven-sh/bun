import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// `bun_ast::Loader` (src/ast/loader.rs) is the one loader numbering. Its
// discriminants cross language boundaries as plain bytes in a few places that
// cannot include a Rust enum, so each keeps a hand-written copy of the values.
// This test fails when any copy drifts from the Rust enum.
const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

/** `{ JSX: 0, JS: 1, …, SQLITE_EMBEDDED: 16, … }` from `pub enum Loader { Jsx = 0, … }`. */
function rustLoaders(): Record<string, number> {
  const body = read("src/ast/loader.rs").match(/pub enum Loader \{([^}]*)\}/)?.[1];
  expect(body).toBeDefined();
  const loaders: Record<string, number> = {};
  for (const [, name, id] of body!.matchAll(/^\s*([A-Z][A-Za-z0-9]*)\s*=\s*(\d+),/gm)) {
    loaders[name.replace(/(?<=[a-z0-9])([A-Z])/g, "_$1").toUpperCase()] = Number(id);
  }
  expect(Object.keys(loaders).length).toBeGreaterThan(10);
  return loaders;
}

function constants(source: string, pattern: RegExp): Record<string, number> {
  const found: Record<string, number> = {};
  for (const [, name, value] of source.matchAll(pattern)) found[name] = Number(value);
  expect(Object.keys(found).length).toBeGreaterThan(10);
  return found;
}

const expected = rustLoaders();

test("src/jsc/bindings/headers-handwritten.h BunLoaderType* match bun_ast::Loader", () => {
  const actual = constants(
    read("src/jsc/bindings/headers-handwritten.h"),
    /^inline constexpr BunLoaderType BunLoaderType([A-Za-z0-9_]+) = (\d+);/gm,
  );
  const { None, ...loaders } = actual;
  // `bun_jsc::BunLoaderType::NONE`; must not collide with a real loader.
  expect(None).toBe(255);
  expect(Object.values(expected)).not.toContain(None);
  expect(loaders).toEqual(expected);
});

test.each([
  "packages/bun-native-bundler-plugin-api/bundler_plugin.h",
  "packages/bun-native-plugin-rs/headers/bun-native-bundler-plugin-api/bundler_plugin.h",
])("%s BUN_LOADER_* match bun_ast::Loader", file => {
  expect(constants(read(file), /^\s*BUN_LOADER_([A-Z0-9_]+) = (\d+),/gm)).toEqual(expected);
});

test("packages/bun-native-plugin-rs/src/sys.rs BunLoader matches bun_ast::Loader", () => {
  const body = read("packages/bun-native-plugin-rs/src/sys.rs").match(/pub enum BunLoader \{([^}]*)\}/)?.[1];
  expect(body).toBeDefined();
  expect(constants(body!, /^\s*BUN_LOADER_([A-Z0-9_]+) = (\d+),/gm)).toEqual(expected);
});
