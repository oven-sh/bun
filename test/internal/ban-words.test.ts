import { file } from "bun";
import path from "path";
import { globAllSources } from "../../scripts/glob-sources.ts";

// prettier-ignore
const words: Record<string, { reason: string; regex?: boolean }> = {
  " != undefined": { reason: "This is by definition Undefined Behavior." },
  " == undefined": { reason: "This is by definition Undefined Behavior." },
  "undefined != ": { reason: "This is by definition Undefined Behavior." },
  "undefined == ": { reason: "This is by definition Undefined Behavior." },

  '@import("bun").': { reason: "Only import 'bun' once" },
  "std.debug.assert": { reason: "Use bun.assert instead" },
  "std.debug.dumpStackTrace": { reason: "Use bun.handleErrorReturnTrace or bun.crash_handler.dumpStackTrace instead" },
  "std.debug.print": { reason: "Don't let this be committed"},
  "std.log": { reason: "Don't let this be committed" },
  "std.mem.indexOfAny(u8": { reason: "Use bun.strings.indexOfAny" },
  "std.StringArrayHashMapUnmanaged(": { reason: "bun.StringArrayHashMapUnmanaged has a faster `eql`" },
  "std.StringArrayHashMap(": { reason: "bun.StringArrayHashMap has a faster `eql`" },
  "std.StringHashMapUnmanaged(": { reason: "bun.StringHashMapUnmanaged has a faster `eql`" },
  "std.StringHashMap(": { reason: "bun.StringHashMap has a faster `eql`" },
  "std.enums.tagName(": { reason: "Use bun.tagName instead" },
  "std.unicode": { reason: "Use bun.strings instead" },
  "std.Thread.Mutex": {reason: "Use bun.Mutex instead" },
  ".jsBoolean(true)": { reason: "Use .true instead" },
  "JSValue.true": { reason: "Use .true instead" },
  ".jsBoolean(false)": { reason: "Use .false instead" },
  "JSValue.false": { reason: "Use .false instead" },

  "allocator.ptr ==": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },
  "allocator.ptr !=": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },
  "== allocator.ptr": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },
  "!= allocator.ptr": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },
  "alloc.ptr ==": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },
  "alloc.ptr !=": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },
  "== alloc.ptr": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },
  "!= alloc.ptr": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },

  ": [^=]+= undefined,$": { reason: "Do not default a struct field to undefined", regex: true },
  "usingnamespace": { reason: "Zig 0.15 will remove `usingnamespace`" },

  "std.fs.Dir": { reason: "Prefer bun.sys + bun.FD instead of std.fs" },
  "std.fs.cwd": { reason: "Prefer bun.FD.cwd()" },
  "std.fs.File": { reason: "Prefer bun.sys + bun.FD instead of std.fs" },
  "std.fs.openFileAbsolute": { reason: "Prefer bun.sys + bun.FD instead of std.fs" },
  ".stdFile()": { reason: "Prefer bun.sys + bun.FD instead of std.fs.File. Zig hides 'errno' when Bun wants to match libuv" },
  ".stdDir()": { reason: "Prefer bun.sys + bun.FD instead of std.fs.File. Zig hides 'errno' when Bun wants to match libuv" },
  ".arguments_old(": { reason: "Please migrate to .argumentsAsArray() or another argument API" },
  "// autofix": { reason: "Evaluate if this variable should be deleted entirely or explicitly discarded." },

  "global.hasException": { reason: "Incompatible with strict exception checks. Use a CatchScope instead." },
  "globalObject.hasException": { reason: "Incompatible with strict exception checks. Use a CatchScope instead." },
  "globalThis.hasException": { reason: "Incompatible with strict exception checks. Use a CatchScope instead." },
  "EXCEPTION_ASSERT(!scope.exception())": { reason: "Use scope.assertNoException() instead" },
  " catch bun.outOfMemory()": { reason: "Use bun.handleOom to avoid catching unrelated errors" },
  "TODO: properly propagate exception upwards": { reason: "This entry is here for tracking" },
};
const words_keys = [...Object.keys(words)];

const limits = await Bun.file(import.meta.dir + "/ban-limits.json").json();

const root = path.resolve(import.meta.dir, "..", "..");
const sources = globAllSources().rustSourceFiles;

let counts: Record<string, [number, string][]> = {};

for (const abs of sources) {
  const source = path.relative(root, abs);
  if (/^src[/\\][a-z_]+_sys[/\\]/.test(source)) continue;
  if (source.startsWith("src" + path.sep + "codegen")) continue;
  if (source.startsWith("src" + path.sep + "unicode" + path.sep + "uucode")) continue;
  const content = await file(abs).text();
  for (const word of words_keys) {
    let regex = words[word].regex ? new RegExp(word, "gm") : undefined;
    const did_match = regex ? regex.test(content) : content.includes(word);
    if (regex) regex.lastIndex = 0;
    if (did_match) {
      counts[word] ??= [];
      const lines = content.split("\n");
      for (let line_i = 0; line_i < lines.length; line_i++) {
        const trim = lines[line_i].trim();
        if (trim.startsWith("//") || trim.startsWith("\\\\")) continue;
        const count = regex ? [...lines[line_i].matchAll(regex)].length : lines[line_i].split(word).length - 1;
        for (let count_i = 0; count_i < count; count_i++) {
          counts[word].push([line_i + 1, source]);
        }
      }
    }
  }
}

if (typeof describe === "undefined") {
  const newLimits = {};
  for (const word of Object.keys(words).sort()) {
    const count = counts[word] ?? [];
    let newLimit = count.length;
    if (!process.argv.includes("--allow-increase")) {
      if (newLimit > (limits[word] ?? Infinity)) {
        const limit = limits[word] ?? Infinity;
        console.log(
          `${JSON.stringify(word)} is banned.\nThis PR increases the number of instances of this word from ${limit} to ${count.length}\nBan reason: ${words[word].reason}\n` +
            (limit === 0
              ? `Remove banned word from:\n${count.map(([line, path]) => `- ${path}:${line}\n`).join("")}`
              : "") +
            "Or increase the limit by running \`bun ./test/internal/ban-words.test.ts --allow-increase\`\n",
        );
      }
      newLimit = Math.min(newLimit, limits[word] ?? Infinity);
    }
    newLimits[word] = newLimit;
  }
  await Bun.write(import.meta.dir + "/ban-limits.json", JSON.stringify(newLimits, null, 2));
  process.exit(0);
}

describe("banned words", () => {
  for (const [i, [word, { reason }]] of Object.entries(words).entries()) {
    const limit = limits[word] ?? Infinity;
    test(word + (limit !== 0 ? " (max " + limit + ")" : ""), () => {
      const count = counts[word] ?? [];
      if (count.length > limit) {
        throw new Error(
          `${JSON.stringify(word)} is banned.\nThis PR increases the number of instances of this word from ${limit} to ${count.length}\nBan reason: ${reason}\n` +
            (limit === 0
              ? `Remove banned word from:\n${count.map(([line, path]) => `- ${path}:${line}\n`).join("")}`
              : "") +
            "Or increase the limit by running \`bun ./test/internal/ban-words.test.ts --allow-increase\`\n",
        );
      } else if (count.length < limit) {
        throw new Error(
          `Instances of banned word ${JSON.stringify(word)} reduced from ${limit} to ${count.length}\nUpdate limit by running \`bun ./test/internal/ban-words.test.ts\`\n`,
        );
      }
    });
  }
});

describe("required words", () => {
  // The expect matchers used to each open-code the `incrementExpectCallCounter()`
  // call, so the per-file string check above used to catch a forgotten one.
  // The Rust implementation consolidated that boilerplate into a small set of shared
  // helpers (`matcher_prelude`, `run_unary_predicate`, `mock_prologue`,
  // `numeric_ordering_matcher`, `contain_matcher`, …), each of which bumps
  // the counter exactly once. Per-file scanning would only see the handful
  // of bespoke matchers that bump it directly. Guard the centralization
  // points instead.
  const exprFiles = ["src/runtime/test_runner/expect.rs", "src/runtime/test_runner/mod.rs"];
  test("matcher entry points call increment_expect_call_counter", async () => {
    let found = 0;
    for (const rel of exprFiles) {
      const content = await Bun.file(path.join(root, rel)).text();
      found += (content.match(/increment_expect_call_counter/g) ?? []).length;
    }
    if (found === 0) {
      throw new Error(
        `Expected at least one call to increment_expect_call_counter in ${exprFiles.join(", ")}.\n` +
          "Every expect() matcher must increment the per-test call counter (directly or via a shared prelude helper).",
      );
    }
  });
});
