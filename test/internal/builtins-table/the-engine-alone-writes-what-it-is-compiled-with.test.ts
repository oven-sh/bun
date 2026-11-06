// WebKit's own build knows nothing of Bun's natives. What it compiles the engine with has to be what Bun's generator expects of an engine,
// or a prebuilt WebKit and Bun's table would not fit each other.
import { expect, test } from "bun:test";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { crateOf } from "../../../scripts/build/codegen.ts";
import { globAllSources } from "../../../scripts/glob-sources.ts";
import { generateForEngine } from "../../../src/codegen/builtins/engine.ts";
import { generate } from "../../../src/codegen/builtins/index.ts";

const bunRoot = dirname(realpathSync(join(import.meta.dir, "..", "..", "..", "src")));
const javaScriptCore = join(
  process.env.BUN_WEBKIT_PATH ?? join(bunRoot, "vendor", "WebKit"),
  "Source",
  "JavaScriptCore",
);
const hasCheckout = existsSync(join(javaScriptCore, "aot", "builtins", "AOTBuiltinTable.cmake"));
if (!hasCheckout)
  console.error(`SKIPPED: ${basename(import.meta.path)}: no checkout of WebKit in $BUN_WEBKIT_PATH or vendor/WebKit`);

test.skipIf(!hasCheckout)(
  "with its stand-in host the engine writes the files that Bun's generator writes for it",
  async () => {
    const schemas = globAllSources().bindgen;
    const [alone, withBun] = await Promise.all([
      generateForEngine(javaScriptCore),
      generate({
        bunRoot,
        javaScriptCore,
        prebuiltGenerated: null,
        target: "Linux",
        bindgenSources: schemas.map(schema => `${crateOf(schema)}=${schema}`).sort(),
        typesOnly: schemas.filter(schema => schema.endsWith("_test.bind.ts")).map(schema => basename(schema)),
      }),
    ]);
    expect([...alone.engine.keys()].sort()).toEqual([...withBun.engine.keys()].sort());
    for (const [name, text] of alone.engine)
      expect({ name, isSame: text === withBun.engine.get(name) }).toEqual({ name, isSame: true });
    // The tables themselves have little in common: the stand-in host has a handful of entries.
    expect(alone.table.get("AOTBuiltinTableBuiltins.cpp")!.length).toBeLessThan(
      withBun.table.get("AOTBuiltinTableBuiltins.cpp")!.length / 2,
    );
  },
  120_000,
);
