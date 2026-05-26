import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
// Namespace import: if the naming helper is missing, the assertion in the first
// test reports it instead of the whole file erroring at import time.
import * as registryScanner from "../../src/codegen/internal-module-registry-scanner";

const repoRoot = path.join(import.meta.dir, "../..");
const jsDir = path.join(repoRoot, "src/js");

// Compute the registry exactly the way the codegen (src/codegen/bundle-modules.ts)
// does. These names are the entries of the generated ResolvedSourceTag table
// (ResolvedSourceTag.zig / ResolvedSourceTag.rs / SyntheticModuleType.h), whose
// values are the InternalModuleRegistry IDs (`(1 << 9) | id`).
function registryTagNames(): Set<string> {
  const { moduleList, nativeStartIndex } = registryScanner.createInternalModuleRegistry(jsDir);
  const names = new Set<string>();
  for (let i = 0; i < nativeStartIndex; i++) {
    names.add(registryScanner.idToPublicSpecifierOrEnumName(moduleList[i]));
  }
  for (let i = nativeStartIndex; i < moduleList.length; i++) {
    names.add(moduleList[i]);
  }
  return names;
}

describe("internal module registry codegen", () => {
  test("every HardcodedModule name is a generated ResolvedSourceTag entry", () => {
    // The scanner exports the naming helper the codegen uses, so this test can
    // compute registry names exactly the way bundle-modules.ts does.
    expect(typeof registryScanner.idToPublicSpecifierOrEnumName).toBe("function");

    // `get_hardcoded_module` (src/runtime/jsc_hooks.rs) feeds these names to
    // `ResolvedSourceTag::from_name`; a name that is not in the generated table
    // debug-panics (and falls back to the wrong tag in release builds).
    const source = fs.readFileSync(path.join(repoRoot, "src/resolve_builtins/HardcodedModule.rs"), "utf8");
    const enumSection = source.slice(0, source.indexOf("impl HardcodedModule"));
    const strumNames = [...enumSection.matchAll(/#\[strum\(serialize = "([^"]+)"\)\]/g)].map(m => m[1]);
    expect(strumNames.length).toBeGreaterThan(50);

    // Served without going through the registry table (see get_hardcoded_module).
    const specialCased = new Set(["bun:main", "bun:wrap"]);

    const names = registryTagNames();
    expect(names.size).toBeGreaterThan(100);

    const missing = strumNames.filter(name => !specialCased.has(name) && !names.has(name));
    expect(missing).toEqual([]);
  });

  test("the Rust ResolvedSourceTag table is generated, not hardcoded", () => {
    // The `name -> (1 << 9) | id` table must come from codegen
    // (`${BUN_CODEGEN_DIR}/ResolvedSourceTag.rs`); a hand-written copy in src/
    // silently drifts whenever a file is added to or removed from src/js.
    // Boolean checks keep the failure output short (these files are huge).
    const libRs = fs.readFileSync(path.join(repoRoot, "src/jsc/lib.rs"), "utf8");
    expect(libRs.includes('include!(concat!(env!("BUN_CODEGEN_DIR"), "/ResolvedSourceTag.rs"))')).toBe(true);
    const hardcodedTagEntries = libRs.match(/=> ResolvedSourceTag\(\d+\)/g) ?? [];
    expect(hardcodedTagEntries.length).toBe(0);

    const bundleModules = fs.readFileSync(path.join(repoRoot, "src/codegen/bundle-modules.ts"), "utf8");
    expect(bundleModules.includes('"ResolvedSourceTag.zig"')).toBe(true);
    expect(bundleModules.includes('"ResolvedSourceTag.rs"')).toBe(true);
  });

  test("builtin modules served through the registry load correctly", () => {
    // These go through the HardcodedModule -> ResolvedSourceTag::from_name path
    // (js_synthetic_module); a missing or drifted tag loads the wrong registry
    // entry or panics in debug builds.
    expect(typeof require("@vercel/fetch")).toBe("function");
    expect(typeof require("ws").WebSocket).toBe("function");
    expect(typeof require("node-fetch")).toBe("function");
    expect(typeof require("undici").fetch).toBe("function");
    expect(typeof require("isomorphic-fetch")).toBe("function");
    expect(typeof require("utf-8-validate")).toBe("function");
    expect(typeof require("abort-controller").AbortController).toBe("function");
    expect(typeof require("node:punycode").encode).toBe("function");
    expect(typeof require("node:string_decoder").StringDecoder).toBe("function");
    expect(typeof require("node:wasi").WASI).toBe("function");
  });
});
