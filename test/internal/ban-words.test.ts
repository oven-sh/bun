import { file, Glob } from "bun";
import path from "path";
import { normalize } from "path/posix";

// prettier-ignore
const words: Record<string, { reason: string; limit?: number; regex?: boolean }> = {
  " != undefined": { reason: "This is by definition Undefined Behavior." },
  " == undefined": { reason: "This is by definition Undefined Behavior." },
  "undefined != ": { reason: "This is by definition Undefined Behavior." },
  "undefined == ": { reason: "This is by definition Undefined Behavior." },

  '@import("bun").': { reason: "Only import 'bun' once" },
  "std.debug.assert": { reason: "Use bun.assert instead", limit: 26 },
  "std.debug.dumpStackTrace": { reason: "Use bun.handleErrorReturnTrace or bun.crash_handler.dumpStackTrace instead" },
  "std.debug.print": { reason: "Don't let this be committed", limit: 0 },
  "std.log": { reason: "Don't let this be committed", limit: 1 },
  "std.mem.indexOfAny(u8": { reason: "Use bun.strings.indexOfAny" },
  "std.StringArrayHashMapUnmanaged(": { reason: "bun.StringArrayHashMapUnmanaged has a faster `eql`", limit: 12 },
  "std.StringArrayHashMap(": { reason: "bun.StringArrayHashMap has a faster `eql`", limit: 1 },
  "std.StringHashMapUnmanaged(": { reason: "bun.StringHashMapUnmanaged has a faster `eql`" },
  "std.StringHashMap(": { reason: "bun.StringHashMap has a faster `eql`" },
  "std.enums.tagName(": { reason: "Use bun.tagName instead", limit: 2 },
  "std.unicode": { reason: "Use bun.strings instead", limit: 33 },
  "std.Thread.Mutex": {reason: "Use bun.Mutex instead", limit: 1 },

  "allocator.ptr ==": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },
  "allocator.ptr !=": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior", limit: 1 },
  "== allocator.ptr": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },
  "!= allocator.ptr": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },
  "alloc.ptr ==": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },
  "alloc.ptr !=": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },
  "== alloc.ptr": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },
  "!= alloc.ptr": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },

  [String.raw`: [a-zA-Z0-9_\.\*\?\[\]\(\)]+ = undefined,`]: { reason: "Do not default a struct field to undefined", limit: 240, regex: true },
  "usingnamespace": { reason: "Zig 0.15 will remove `usingnamespace`" },
  "catch unreachable": { reason: "For out-of-memory, prefer 'catch bun.outOfMemory()'", limit: 1849 },

  "std.fs.Dir": { reason: "Prefer bun.sys + bun.FD instead of std.fs", limit: 180 },
  "std.fs.cwd": { reason: "Prefer bun.FD.cwd()", limit: 103 },
  "std.fs.File": { reason: "Prefer bun.sys + bun.FD instead of std.fs", limit: 64 },
  ".stdFile()": { reason: "Prefer bun.sys + bun.FD instead of std.fs.File. Zig hides 'errno' when Bun wants to match libuv", limit: 18 },
  ".stdDir()": { reason: "Prefer bun.sys + bun.FD instead of std.fs.File. Zig hides 'errno' when Bun wants to match libuv", limit: 48 },
  ".arguments_old(": { reason: "Please migrate to .argumentsAsArray() or another argument API", limit: 285 },
  "// autofix": { reason: "Evaluate if this variable should be deleted entirely or explicitly discarded.", limit: 176 },
};
const words_keys = [...Object.keys(words)];

const sources: Array<{ output: string; paths: string[]; excludes?: string[] }> = await file(
  path.join("cmake", "Sources.json"),
).json();

let counts: Record<string, [number, string][]> = {};

for (const source of sources) {
  const { paths, excludes } = source;
  for (const pattern of paths) {
    const glob = new Glob(pattern);
    for await (const source of glob.scan()) {
      if (excludes?.some(exclude => normalize(source) === normalize(exclude))) continue;
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
  }
}

describe("banned words", () => {
  for (const [i, [word, { reason, limit = 0 }]] of Object.entries(words).entries()) {
    test(word + (limit !== 0 ? " (max " + limit + ")" : ""), () => {
      const count = counts[word] ?? [];
      if (count.length > limit) {
        throw new Error(
          `${JSON.stringify(word)} is banned.\nThis PR increases the number of instances of this word from ${limit} to ${count.length}\nBan reason: ${reason}\n` +
            (limit === 0
              ? `Remove banned word from:\n${count.map(([line, path]) => `- ${path}:${line}\n`).join("")}`
              : "") +
            "\n",
        );
      } else if (count.length < limit) {
        throw new Error(
          `Instances of banned word ${JSON.stringify(word)} reduced from ${limit} to ${count.length}\nUpdate limit in scripts/ban-words.ts:${i + 5}\n`,
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
