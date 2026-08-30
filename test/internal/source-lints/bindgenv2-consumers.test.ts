import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { globAllSources } from "../../../scripts/glob-sources.ts";
import { NamedType } from "../../../src/codegen/bindgenv2/internal/base.ts";

// Every named type exported from a `*.bindv2.ts` file becomes a generated
// `Generated<Name>.h` (and usually a `Generated<Name>.cpp` that the build
// compiles and links). A dictionary declared with
// `generateConversionFunction: true` also emits an
// `extern "C" bool bindgenConvertJSTo<Name>(...)` entry point, whose only
// caller is a hand-written `extern "C"` declaration on the Rust side
// (`src/jsc/generated.rs`).
//
// Nothing checks that such a type is still used: a bindv2 file whose Rust
// consumer was deleted keeps generating and compiling C++ on every build. A
// named type is live when at least one of these holds:
//   - Rust declares its `bindgenConvertJSTo<Name>` entry point,
//   - a hand-written C++ or Rust source names `Generated<Name>` (include or
//     `Bun::Bindgen::Generated::<Name>` reference),
//   - it is a dependency (member type) of a live named type.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const sources = globAllSources();

function rel(file: string): string {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function collectNamedDependencies(type: NamedType, into: Set<NamedType>): void {
  for (const dependency of type.dependencies) {
    if (dependency instanceof NamedType) {
      into.add(dependency);
    }
    collectNamedDependencies(dependency as NamedType, into);
  }
}

test("every bindgenv2 named type has a consumer", async () => {
  const headers = [...new Glob("src/**/*.h").scanSync({ cwd: root, absolute: true })];
  const handWritten = [...sources.rust, ...sources.cxx, ...headers].filter(
    file => /\.(rs|cpp|h)$/.test(file) && !rel(file).startsWith("src/codegen/"),
  );
  const handWrittenText = handWritten.map(file => readFileSync(file, "utf8")).join("\n");

  const types: { type: NamedType; file: string }[] = [];
  for (const file of sources.bindgenV2) {
    const mod = await import(file);
    for (const value of Object.values(mod)) {
      if (value instanceof NamedType) types.push({ type: value, file: rel(file) });
    }
  }
  expect(types.length).toBeGreaterThan(0);

  const live = new Set<NamedType>();
  for (const { type } of types) {
    const header = type.hasCppHeader ? (type.cppHeader ?? "") : "";
    const conversionFunction = header.includes(`bindgenConvertJSTo${type.name}(`);
    const rustDeclaresConversion =
      conversionFunction && new RegExp(`\\bfn bindgenConvertJSTo${type.name}\\s*\\(`).test(handWrittenText);
    const namedBySource = new RegExp(`\\bGenerated${type.name}\\b`).test(handWrittenText);
    if (rustDeclaresConversion || namedBySource) live.add(type);
  }
  // A member type of a live dictionary is generated into that dictionary's
  // header, so it is live too.
  for (const type of [...live]) {
    collectNamedDependencies(type, live);
  }

  const dead = types
    .filter(({ type }) => !live.has(type))
    .map(({ type, file }) => `${file}: ${type.name} has no Rust or C++ consumer`);
  expect(dead).toEqual([]);
});
