/** scripts/build/forwarding-headers.ts: one header for each name of the engine's that a source, a generator or a schema spells. */
import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { readdirSync, readFileSync, statSync, utimesSync } from "node:fs";
import { join, relative } from "node:path";

import { generateForwardingHeaders } from "../../../scripts/build/forwarding-headers.ts";

function textsIn(directory: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => join(entry.parentPath, entry.name))
      .map(path => [relative(directory, path).replaceAll("\\", "/"), readFileSync(path, "utf8")]),
  );
}

test("each name forwards to the header that declares what it stands for", () => {
  using dir = tempDir("build-forwarding-headers", {
    "a.cpp": [
      `#include <JavaScriptCore/VM.h>`,
      `#include "JavaScriptCore/JSDateMath-v8.h"`,
      `#  include <wtf/text/StringView.h>`,
      `#include "wtf/SIMDUTF.h"`,
      `#include "webcore/wtf/Other.h"`,
      `#include <vector>`,
    ].join("\n"),
    "b.c": `#if __has_include("wtf/Platform.h")\n#endif\n`,
    "c.bind.ts": `b.cell("JSC::JSPromise", "JavaScriptCore/JSPromise.h");\n`,
  });
  const buildDir = join(String(dir), "build");
  const files = ["a.cpp", "b.c", "c.bind.ts"].map(name => join(String(dir), name));

  const directory = generateForwardingHeaders({ buildDir }, files);

  expect(directory).toBe(join(buildDir, "forwarding-headers"));
  expect(textsIn(directory)).toEqual({
    "JavaScriptCore/VM.h": `#include "engine/Engine.h"\n`,
    "JavaScriptCore/JSDateMath-v8.h": `#include "engine/Engine.h"\n`,
    "JavaScriptCore/JSPromise.h": `#include "engine/Engine.h"\n`,
    "wtf/text/StringView.h": `#include "engine/Support.h"\n`,
    "wtf/Platform.h": `#include "engine/Support.h"\n`,
    "wtf/SIMDUTF.h": `#include <simdutf.h>\n`,
  });
});

test("a header that is still named keeps its time, and one that is not goes", () => {
  using dir = tempDir("build-forwarding-headers", {
    "kept.h": `#include <wtf/Kept.h>\n`,
    "dropped.h": `#include <wtf/text/Dropped.h>\n`,
  });
  const buildDir = join(String(dir), "build");
  const [kept, dropped] = ["kept.h", "dropped.h"].map(name => join(String(dir), name)) as [string, string];
  const directory = generateForwardingHeaders({ buildDir }, [kept, dropped]);
  const longAgo = new Date(1_000_000_000_000);
  utimesSync(join(directory, "wtf", "Kept.h"), longAgo, longAgo);

  generateForwardingHeaders({ buildDir }, [kept]);

  expect(Object.keys(textsIn(directory))).toEqual(["wtf/Kept.h"]);
  expect(statSync(join(directory, "wtf", "Kept.h")).mtime).toEqual(longAgo);
});
