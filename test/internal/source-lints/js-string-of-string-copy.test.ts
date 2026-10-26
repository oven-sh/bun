import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// `Zig::toStringCopy` returns the null string when it cannot make the copy: the
// string would be too long, or its allocation failed. `JSC::jsString` turns the
// null string into "". Passed straight from one to the other, a failed copy
// reaches JavaScript as an empty string with no error, which is how
// `new TextDecoder().decode(bytes)` lost 2 GiB of input.
//
//   jsString(vm, Zig::toStringCopy(slice))  → Bun::toJS(globalObject, slice)
//
// `Bun::toJS` makes the same string, and throws ERR_STRING_TOO_LONG or
// ERR_MEMORY_ALLOCATION_FAILED when it cannot.
test("no C++ source passes Zig::toStringCopy straight to jsString", async () => {
  const root = path.resolve(import.meta.dir, "..", "..", "..", "src");
  const offenders: string[] = [];
  let scanned = 0;
  for await (const file of new Glob("**/*.{h,cpp}").scan({ cwd: root })) {
    scanned++;
    const lines = readFileSync(path.join(root, file), "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (/\bjsString\s*\(.*\btoStringCopy\s*\(/.test(lines[i])) {
        offenders.push(`src/${file.replaceAll("\\", "/")}:${i + 1}`);
      }
    }
  }
  // A wrong `root` would make the ban below pass with nothing scanned.
  expect(scanned).toBeGreaterThan(0);
  expect(offenders.sort()).toEqual([]);
});
