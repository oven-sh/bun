import { file } from "bun";
import path from "path";

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

  "allocator.ptr ==": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },
  "allocator.ptr !=": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },
  "== allocator.ptr": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },
  "!= allocator.ptr": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },
  "alloc.ptr ==": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },
  "alloc.ptr !=": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },
  "== alloc.ptr": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },
  "!= alloc.ptr": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },

  [String.raw`: [a-zA-Z0-9_\.\*\?\[\]\(\)]+ = undefined,`]: { reason: "Do not default a struct field to undefined", regex: true },
  "usingnamespace": { reason: "Zig 0.15 will remove `usingnamespace`" },

  "std.fs.Dir": { reason: "Prefer bun.sys + bun.FD instead of std.fs" },
  "std.fs.cwd": { reason: "Prefer bun.FD.cwd()" },
  "std.fs.File": { reason: "Prefer bun.sys + bun.FD instead of std.fs" },
  ".stdFile()": { reason: "Prefer bun.sys + bun.FD instead of std.fs.File. Zig hides 'errno' when Bun wants to match libuv" },
  ".stdDir()": { reason: "Prefer bun.sys + bun.FD instead of std.fs.File. Zig hides 'errno' when Bun wants to match libuv" },
  ".arguments_old(": { reason: "Please migrate to .argumentsAsArray() or another argument API" },
  "// autofix": { reason: "Evaluate if this variable should be deleted entirely or explicitly discarded." },

  "global.hasException": { reason: "Incompatible with strict exception checks. Use a CatchScope instead." },
  "globalObject.hasException": { reason: "Incompatible with strict exception checks. Use a CatchScope instead." },
  "globalThis.hasException": { reason: "Incompatible with strict exception checks. Use a CatchScope instead." },

  ".ptr[": { reason: "'.ptr[...]' bypasses bounds detection. Index or slice directly instead." },
};
const words_keys = [...Object.keys(words)];

const limits = await Bun.file(import.meta.dir + "/ban-limits.json").json();

const sources: Array<{ output: string; paths: string[]; excludes?: string[] }> = await file(
  path.join("cmake", "Sources.json"),
).json();

let counts: Record<string, [number, string][]> = {};

const zigSources = await Bun.file(import.meta.dir + "/../../cmake/sources/ZigSources.txt").text();
const zigSourcesLines = zigSources
  .split("\n")
  .map(line => line.trim())
  .filter(line => line.length > 0 && !line.startsWith("#"));

for (const source of zigSourcesLines) {
  if (!source.endsWith(".zig")) continue;
  if (source.startsWith("src" + path.sep + "deps")) continue;
  if (source.startsWith("src" + path.sep + "codegen")) continue;
  const content = await file(source).text();
  for (const word of words_keys) {
    let regex = words[word].regex ? new RegExp(word, "g") : undefined;
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

const newLimits = {};
for (const word of Object.keys(words).sort()) {
  const count = counts[word] ?? [];
  let newLimit = count.length;
  if (!process.argv.includes("--allow-increase")) {
    if (newLimit > (limits[word] ?? 0)) {
      const limit = limits[word] ?? 0;
      console.log(
        `${JSON.stringify(word)} is banned.\nThis PR increases the number of instances of this word from ${limit} to ${count.length}\nBan reason: ${words[word].reason}\n` +
          (limit === 0
            ? `Remove banned word from:\n${count.map(([line, path]) => `- ${path}:${line}\n`).join("")}`
            : "") +
          "Or increase the limit by running \`bun ./test/internal/ban-words.test.ts --allow-increase\`\n",
      );
    }
    newLimit = Math.min(newLimit, limits[word] ?? 0);
  }
  if (newLimit !== 0) newLimits[word] = newLimit;
}
await Bun.write(import.meta.dir + "/ban-limits.json", JSON.stringify(newLimits, null, 2));
if (typeof describe === "undefined") {
  process.exit(0);
}

describe("banned words", () => {
  for (const [i, [word, { reason }]] of Object.entries(words).entries()) {
    const limit = limits[word] ?? 0;
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

describe("files that must have comments at the top", () => {
  const files = ["src/bun.js/api/BunObject.zig"];

  for (const file of files) {
    test(file, async () => {
      const joined = path.join(import.meta.dir, "..", "..", file);
      const content = await Bun.file(joined).text();
      if (!content.startsWith("//")) {
        throw new Error(`Please don't add imports to the top of ${file}. Put them at the bottom.`);
      }
    });
  }
});
