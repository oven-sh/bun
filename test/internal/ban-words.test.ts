import { readdir } from "fs/promises";
import path from "path";

// prettier-ignore
const words: Record<string, { reason: string; limit?: number; regex?: boolean }> = {
  " != undefined": { reason: "This is by definition Undefined Behavior." },
  " == undefined": { reason: "This is by definition Undefined Behavior." },
  '@import("root").bun.': { reason: "Only import 'bun' once" },
  "std.debug.assert": { reason: "Use bun.assert instead", limit: 25 },
  "std.debug.dumpStackTrace": { reason: "Use bun.handleErrorReturnTrace or bun.crash_handler.dumpStackTrace instead" },
  "std.debug.print": { reason: "Don't let this be committed", limit: 2 },
  "std.mem.indexOfAny(u8": { reason: "Use bun.strings.indexOfAny", limit: 3 },
  "undefined != ": { reason: "This is by definition Undefined Behavior." },
  "undefined == ": { reason: "This is by definition Undefined Behavior." },
  "bun.toFD(std.fs.cwd().fd)": { reason: "Use bun.FD.cwd()" },
  "std.StringArrayHashMapUnmanaged(": { reason: "bun.StringArrayHashMapUnmanaged has a faster `eql`", limit: 12 },
  "std.StringArrayHashMap(": { reason: "bun.StringArrayHashMap has a faster `eql`", limit: 1 },
  "std.StringHashMapUnmanaged(": { reason: "bun.StringHashMapUnmanaged has a faster `eql`" },
  "std.StringHashMap(": { reason: "bun.StringHashMap has a faster `eql`" },
  "std.enums.tagName(": { reason: "Use bun.tagName instead", limit: 2 },
  "std.unicode": { reason: "Use bun.strings instead", limit: 36 },
  "allocator.ptr ==": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },
  "allocator.ptr !=": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior", limit: 1 },
  "== allocator.ptr": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },
  "!= allocator.ptr": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },
  "alloc.ptr ==": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },
  "alloc.ptr !=": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },
  "== alloc.ptr": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },
  "!= alloc.ptr": { reason: "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior" },
  [String.raw`: [a-zA-Z0-9_\.\*\?\[\]\(\)]+ = undefined,`]: { reason: "Do not default a struct field to undefined", limit: 244, regex: true },
  "usingnamespace": { reason: "Zig deprecates this, and will not support it in incremental compilation.", limit: 492 },
};
const words_keys = [...Object.keys(words)];

let counts: Record<string, [number, string][]> = {};
const files = await readdir("src", { recursive: true, withFileTypes: true });
for (const file of files) {
  if (file.isDirectory()) continue;
  if (!file.name.endsWith(".zig")) continue;
  if (file.parentPath.startsWith("src" + path.sep + "deps")) continue;
  const content = await Bun.file(file.parentPath + path.sep + file.name).text();
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
          counts[word].push([line_i + 1, file.parentPath + path.sep + file.name]);
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
