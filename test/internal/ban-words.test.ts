import { file, Glob } from "bun";
import { readdirSync } from "fs";
import path from "path";
import "../../scripts/glob-sources.mjs";

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

const sources: Array<{ output: string; paths: string[]; excludes?: string[] }> = await file(
  path.join("cmake", "Sources.json"),
).json();

let counts: Record<string, [number, string][]> = {};

for (const source of sources) {
  const { paths, excludes } = source;

  for (const pattern of paths) {
    const glob = new Glob(pattern);

    for await (const source of glob.scan()) {
      if (!source.endsWith(".zig")) continue;
      if (source.startsWith("src" + path.sep + "deps")) continue;
      if (source.startsWith("src" + path.sep + "codegen")) continue;
      if (source.startsWith("src" + path.sep + "unicode" + path.sep + "uucode")) continue;
      const content = await file(source).text();
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
  const expectDir = "src/bun.js/test/expect";
  const files = readdirSync(expectDir);
  for (const file of files) {
    if (!file.endsWith(".zig") || file.startsWith(".") || file === "toHaveReturnedTimes.zig") continue;
    test(file, async () => {
      const content = await Bun.file(path.join(expectDir, file)).text();
      if (!content.includes("incrementExpectCallCounter")) {
        throw new Error(
          `${expectDir}/${file} is missing string "incrementExpectCallCounter"\nAll expect() functions must call incrementExpectCallCounter()`,
        );
      }
    });
  }
});
