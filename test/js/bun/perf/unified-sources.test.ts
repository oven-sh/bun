import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { basename, resolve } from "node:path";
import type { Config } from "../../../../scripts/build/config.ts";
import { generateUnifiedSources } from "../../../../scripts/build/unified.ts";

/**
 * The C++ build's wall-clock floor is roughly
 *   codegen-critical-path + pch + max(cxx) + sum(cxx)/cores
 * so an outsized bundle or a directory compiling standalone dominates both the
 * tail and the aggregate. `bun run build:analyze` surfaces the numbers, and
 * these checks lock in the bundling decisions it informed, chiefly
 * webcore/streams bundled (not `noUnifyDirs`).
 */

const repo = resolve(import.meta.dir, "../../../..");

function split(release: boolean, sources: readonly string[]) {
  using dir = tempDir("unified-sources", {});
  const cfg = {
    cwd: repo,
    buildDir: String(dir),
    release,
    unifiedSources: true,
  } as Config;
  const abs = sources.map(s => resolve(repo, s));
  const result = generateUnifiedSources(cfg, abs);
  return {
    unified: result.unified.map(p => basename(p)),
    standalone: new Set(result.standalone.map(p => p.slice(repo.length + 1).replaceAll("\\", "/"))),
    bundled: new Set(result.bundled.map(p => p.slice(repo.length + 1).replaceAll("\\", "/"))),
  };
}

describe("unified-source bundling", () => {
  test("webcore/streams compiles as unified bundles, not standalone", () => {
    // Each of these used to be a standalone compile re-parsing the same
    // JSC/WebCore headers (~256s aggregate frontend). With the copy-pasted
    // static helpers deduplicated they bundle cleanly; falling back to
    // noUnifyDirs would give that time back.
    const streams = [
      "src/jsc/bindings/webcore/streams/JSReadableStream.cpp",
      "src/jsc/bindings/webcore/streams/JSWritableStream.cpp",
      "src/jsc/bindings/webcore/streams/JSTransformStream.cpp",
      "src/jsc/bindings/webcore/streams/ReadableStreamOperations.cpp",
      "src/jsc/bindings/webcore/streams/WritableStreamOperations.cpp",
      "src/jsc/bindings/webcore/streams/TransformStreamOperations.cpp",
      "src/jsc/bindings/webcore/streams/WebStreamsMisc.cpp",
      "src/jsc/bindings/webcore/streams/WebStreamsExports.cpp",
      "src/jsc/bindings/webcore/streams/JSStreamsRuntime.cpp",
    ];
    const { unified, standalone, bundled } = split(true, streams);
    for (const s of streams) {
      expect(standalone.has(s)).toBe(false);
      expect(bundled.has(s)).toBe(true);
    }
    expect(unified).toEqual(["UnifiedSource-src_jsc_bindings_webcore_streams-0.cpp"]);
  });

  test("InternalModuleRegistry.cpp bundles with its siblings", () => {
    // InternalModuleRegistryConstants.h stopped embedding module source bytes
    // (#35071 links them via .incbin), so the file is an ordinary small TU.
    const bindings = [
      "src/jsc/bindings/AsyncContextFrame.cpp",
      "src/jsc/bindings/InternalModuleRegistry.cpp",
      "src/jsc/bindings/ErrorCode.cpp",
    ];
    const { standalone, bundled } = split(true, bindings);
    expect(standalone.has("src/jsc/bindings/InternalModuleRegistry.cpp")).toBe(false);
    expect(bundled.has("src/jsc/bindings/InternalModuleRegistry.cpp")).toBe(true);
  });

  test("the heavy standalone list stays in noUnify", () => {
    // These already saturate a core on their own (or have per-file flag
    // overrides / macro pollution); re-bundling them serializes work that
    // should run in parallel.
    const bindings = [
      "src/jsc/bindings/ZigGlobalObject.cpp",
      "src/jsc/bindings/BunObject.cpp",
      "src/jsc/bindings/bindings.cpp",
      "src/jsc/bindings/BunProcess.cpp",
      "src/jsc/bindings/napi.cpp",
      // two ordinary siblings so the directory doesn't fall through the
      // single-file-in-dir path:
      "src/jsc/bindings/AsyncContextFrame.cpp",
      "src/jsc/bindings/ErrorCode.cpp",
    ];
    const { standalone, bundled } = split(true, bindings);
    expect(standalone.has("src/jsc/bindings/ZigGlobalObject.cpp")).toBe(true);
    expect(standalone.has("src/jsc/bindings/BunObject.cpp")).toBe(true);
    expect(standalone.has("src/jsc/bindings/bindings.cpp")).toBe(true);
    expect(standalone.has("src/jsc/bindings/BunProcess.cpp")).toBe(true);
    expect(standalone.has("src/jsc/bindings/napi.cpp")).toBe(true);
    expect(bundled.has("src/jsc/bindings/AsyncContextFrame.cpp")).toBe(true);
    expect(bundled.has("src/jsc/bindings/ErrorCode.cpp")).toBe(true);
  });

  test("debug builds use a smaller batch so incremental edits stay cheap", () => {
    const many = Array.from({ length: 40 }, (_, i) => `src/jsc/bindings/webcore/Gen${i}.cpp`);
    expect(split(true, many).unified.length).toBe(2);
    expect(split(false, many).unified.length).toBe(5);
  });
});
