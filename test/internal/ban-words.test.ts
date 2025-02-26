import { readdir } from "fs/promises";

const words: Record<string, { reason: string; limit?: number }> = {
  " != undefined": { reason: "This is by definition Undefined Behavior." },
  " == undefined": { reason: "This is by definition Undefined Behavior." },
  '@import("root").bun.': { reason: "Only import 'bun' once" },
  "std.debug.assert": { reason: "Use bun.assert instead", limit: 22 },
  "std.debug.dumpStackTrace": { reason: "Use bun.handleErrorReturnTrace or bun.crash_handler.dumpStackTrace instead" },
  "std.debug.print": { reason: "Don't let this be committed", limit: 2 },
  "std.mem.indexOfAny(u8": { reason: "Use bun.strings.indexOfAny", limit: 3 },
  "undefined != ": { reason: "This is by definition Undefined Behavior." },
  "undefined == ": { reason: "This is by definition Undefined Behavior." },
  "bun.toFD(std.fs.cwd().fd)": { reason: "Use bun.FD.cwd()" },
  "std.StringArrayHashMapUnmanaged(": { reason: "bun.StringArrayHashMapUnmanaged has a faster `eql`", limit: 11 },
  "std.StringArrayHashMap(": { reason: "bun.StringArrayHashMap has a faster `eql`", limit: 1 },
  "std.StringHashMapUnmanaged(": { reason: "bun.StringHashMapUnmanaged has a faster `eql`" },
  "std.StringHashMap(": { reason: "bun.StringHashMap has a faster `eql`" },
  "std.enums.tagName(": { reason: "Use bun.tagName instead", limit: 2 },
  "std.unicode": { reason: "Use bun.strings instead", limit: 36 },
};
const words_keys = [...Object.keys(words)];

let counts: Record<string, [number, string][]> = {};
const files = await readdir("src", { recursive: true, withFileTypes: true });
for (const file of files) {
  if (file.isDirectory()) continue;
  if (!file.name.endsWith(".zig")) continue;
  const content = await Bun.file(file.parentPath + "/" + file.name).text();
  for (const word of words_keys) {
    if (content.includes(word)) {
      counts[word] ??= [];
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const trim = lines[i].trim();
        if (trim.startsWith("//") || trim.startsWith("\\\\")) continue;
        const count = lines[i].split(word).length - 1;
        for (let i = 0; i < count; i++) {
          counts[word].push([i + 1, file.parentPath + "/" + file.name]);
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
          `Instances of banned word ${JSON.stringify(word)} reduced from ${limit} to ${count.length}\nUpdate limit in scripts/ban-words.ts:${i + 4}\n`,
        );
      }
    });
  }
});
