import { readdir } from "fs/promises";
import path from "path";

const words2: BannedWord[] = [];

banWord(" != undefined", "This is by definition Undefined Behavior.");
banWord(" == undefined", "This is by definition Undefined Behavior.");
banWord("undefined != ", "This is by definition Undefined Behavior.");
banWord("undefined == ", "This is by definition Undefined Behavior.");

banWord('@import("bun").', "Only import 'bun' once");
banWord("std.debug.assert", "Use bun.assert instead", 26);
banWord("std.debug.dumpStackTrace", "Use bun.handleErrorReturnTrace or bun.crash_handler.dumpStackTrace instead");
banWord("std.debug.print", "Don't let this be committed", 0);
banWord("std.mem.indexOfAny(u8", "Use bun.strings.indexOfAny", 2);
banWord("std.StringArrayHashMapUnmanaged(", "bun.StringArrayHashMapUnmanaged has a faster `eql`", 12);
banWord("std.StringArrayHashMap(", "bun.StringArrayHashMap has a faster `eql`", 1);
banWord("std.StringHashMapUnmanaged(", "bun.StringHashMapUnmanaged has a faster `eql`");
banWord("std.StringHashMap(", "bun.StringHashMap has a faster `eql`");
banWord("std.enums.tagName(", "Use bun.tagName instead", 2);
banWord("std.unicode", "Use bun.strings instead", 33);

const allocator_ptr_ban_msg =
  "The std.mem.Allocator context pointer can be undefined, which makes this comparison undefined behavior";
banWord("allocator.ptr ==", allocator_ptr_ban_msg);
banWord("allocator.ptr !=", allocator_ptr_ban_msg, 1);
banWord("== allocator.ptr", allocator_ptr_ban_msg);
banWord("!= allocator.ptr", allocator_ptr_ban_msg);
banWord("alloc.ptr ==", allocator_ptr_ban_msg);
banWord("alloc.ptr !=", allocator_ptr_ban_msg);
banWord("== alloc.ptr", allocator_ptr_ban_msg);
banWord("!= alloc.ptr", allocator_ptr_ban_msg);

banWord(/: [a-zA-Z0-9_.*?[\]()]+ = undefined,/g, "Do not default a struct field to undefined", 241);
banWord("usingnamespace", "Zig 0.15 will remove `usingnamespace`");

const prefer_bun_reason =
  "Prefer bun.sys + bun.FD instead of std.fs.File. Zig hides 'errno' when Bun wants to match libuv";
banWord("std.fs.Dir", prefer_bun_reason, 180);
banWord("std.fs.cwd", "Prefer bun.FD.cwd()", 103);
banWord("std.fs.File", prefer_bun_reason, 64);
banWord(".stdFile()", prefer_bun_reason, 18);
banWord(".stdDir()", prefer_bun_reason, 48);

banWord(".arguments_old(", "Please migrate to .argumentsAsArray() or another argument API", 289);
banWord("// autofix", "Evaluate if this variable should be deleted entirely or explicitly discarded.", 176);
banWord(
  /catch unreachable(?!;\s*\/\/)/g,
  "Justify usage in a comment. Prefer handling error, or using catch bun.outOfMemory() for OutOfMemory errors.",
  1849,
);

const files = await readdir("src", { recursive: true, withFileTypes: true });
for (const file of files) {
  if (file.isDirectory()) continue;
  if (!file.name.endsWith(".zig")) continue;
  if (file.parentPath.startsWith("src" + path.sep + "deps")) continue;
  if (file.parentPath.startsWith("src" + path.sep + "codegen")) continue;
  const content = await Bun.file(file.parentPath + path.sep + file.name).text();
  for (const banned of words2) {
    let regex = banned.value instanceof RegExp ? banned.value : undefined;
    const did_match = regex ? regex.test(content) : content.includes(banned.value as string);
    if (regex) regex.lastIndex = 0;
    if (did_match) {
      const lines = content.split("\n");
      for (let line_i = 0; line_i < lines.length; line_i++) {
        const trim = lines[line_i].trim();
        if (trim.startsWith("//") || trim.startsWith("\\\\")) continue;
        const count = regex
          ? [...lines[line_i].matchAll(regex)].length
          : lines[line_i].split(banned.value as string).length - 1;
        for (let count_i = 0; count_i < count; count_i++) {
          banned.counts.push([line_i + 1, file.parentPath + path.sep + file.name]);
        }
      }
    }
  }
}

function banWord(value: string | RegExp, msg: string, limit: number = 0) {
  const stack_line = new Error("--").stack
    ?.split("\n")
    .find(l => l.includes("ban-words.test.ts") && !l.includes("banWord"));
  words2.push({ value, reason: msg, limit, error_pos: stack_line, counts: [] });
}

type BannedWord = {
  value: string | RegExp;
  reason: string;
  limit: number;
  error_pos: string | undefined;
  counts: [number, string][];
};

describe("banned words", () => {
  for (const banned of words2) {
    test(banned.value.toString() + (banned.limit !== 0 ? " (max " + banned.limit + ")" : ""), () => {
      const count = banned.counts;
      if (count.length > banned.limit) {
        throw new Error(
          `${JSON.stringify(banned.value)} is banned.\nThis PR increases the number of instances of this word from ${banned.limit} to ${count.length}\nBan reason: ${banned.reason}\n` +
            (banned.limit === 0
              ? `Remove banned word from:\n${count.map(([line, path]) => `- ${path}:${line}\n`).join("")}`
              : "") +
            "\n",
        );
      } else if (count.length < banned.limit) {
        throw new Error(
          `Instances of banned word ${JSON.stringify(banned.value)} reduced from ${banned.limit} to ${count.length}\nUpdate limit\n${banned.error_pos}\n`,
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
