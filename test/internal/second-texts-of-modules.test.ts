// A module of src/js may have a second text, under the same name in src/js/ahead-of-time: `bun run` evaluates the first, and the
// compiler reads the second in its place. The two must do the same, so whoever changes the first has to look at the second. Each
// second text names, in a comment at its head, the SHA-256 of the first text that it was written against.
import { Glob } from "bun";
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const modules = join(import.meta.dir, "../../src/js");
const read = (file: string) => readFileSync(file, "utf8").replaceAll("\r\n", "\n");

test("every second text was written against the first text as it is now", () => {
  const toVisit: Record<string, string> = {};
  const files = [...new Glob("**/*.{js,ts}").scanSync({ cwd: join(modules, "ahead-of-time") })]
    .map(file => file.replaceAll("\\", "/"))
    .sort();
  expect(files).toContain("internal/primordials.js");
  for (const file of files) {
    if (!existsSync(join(modules, file))) {
      toVisit[file] = `src/js/${file} is gone`;
      continue;
    }
    const hash = new Bun.CryptoHasher("sha256").update(read(join(modules, file))).digest("hex");
    const head = read(join(modules, "ahead-of-time", file))
      .split("\n", 8)
      .join("\n");
    if (/^\/\/ .*\bSHA-256 ([0-9a-f]{64})\b/m.exec(head)?.[1] !== hash) {
      toVisit[file] =
        `src/js/${file} has changed: bring the change to src/js/ahead-of-time/${file}, then write SHA-256 ${hash} at its head`;
    }
  }
  expect(toVisit).toEqual({});
});
