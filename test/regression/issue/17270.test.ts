// https://github.com/oven-sh/bun/issues/17270
// `--watch` stops watching a file once a runtime plugin's onLoad handler
// matches it, because the normal transpile path (which registers the file
// with the watcher) is bypassed.
import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, forEachLine, isBroken, isWindows, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const plugin = `
import { plugin, file } from "bun";

await plugin({
  name: "repro",
  setup(builder) {
    builder.onLoad({ filter: /foo\\.js$/ }, async ({ path }) => {
      const contents = await file(path).text();
      if (contents.includes("BAD")) {
        console.log("PLUGIN-ERROR");
        throw new Error("bad contents in " + path);
      }
      return { contents, loader: "js" };
    });
  },
});
`;

async function nextMatching(iter: AsyncGenerator<string>, needle: string) {
  // Manual .next() — `for await` would call .return() on early exit and
  // close the generator, but we need to keep reading across multiple calls.
  while (true) {
    const { value, done } = await iter.next();
    if (done) throw new Error(`stream ended before seeing ${JSON.stringify(needle)}`);
    if (value.includes(needle)) return value;
  }
}

describe.todoIf(isBroken && isWindows)(
  "issue #17270: --watch keeps watching files handled by runtime plugin onLoad",
  () => {
    test("after onLoad throws", async () => {
      using dir = tempDir("watch-plugin-throw", {
        "bunfig.toml": `preload = ["./plugin.js"]\n`,
        "plugin.js": plugin,
        "entry.js": `import "./foo.js";\n`,
        "foo.js": `BAD; console.log("hello v1");\n`,
      });
      const fooPath = join(String(dir), "foo.js");

      await using proc = spawn({
        cmd: [bunExe(), "--watch", "entry.js"],
        cwd: String(dir),
        env: bunEnv,
        stdio: ["ignore", "pipe", "inherit"],
      });

      const iter = forEachLine(proc.stdout);

      // First run: plugin throws, emits PLUGIN-ERROR on stdout before throwing.
      expect(await nextMatching(iter, "PLUGIN-ERROR")).toContain("PLUGIN-ERROR");

      // Fix the file. The watcher should pick this up and reload.
      writeFileSync(fooPath, `console.log("hello v2");\n`);
      expect(await nextMatching(iter, "hello v2")).toContain("hello v2");

      // Subsequent edits to a plugin-handled file that previously succeeded
      // must also be picked up.
      writeFileSync(fooPath, `console.log("hello v3");\n`);
      expect(await nextMatching(iter, "hello v3")).toContain("hello v3");

      proc.kill();
      await proc.exited;
    }, 15000);

    test("after onLoad succeeds", async () => {
      using dir = tempDir("watch-plugin-ok", {
        "bunfig.toml": `preload = ["./plugin.js"]\n`,
        "plugin.js": plugin,
        "entry.js": `import "./foo.js";\n`,
        "foo.js": `console.log("hello v1");\n`,
      });
      const fooPath = join(String(dir), "foo.js");

      await using proc = spawn({
        cmd: [bunExe(), "--watch", "entry.js"],
        cwd: String(dir),
        env: bunEnv,
        stdio: ["ignore", "pipe", "inherit"],
      });

      const iter = forEachLine(proc.stdout);

      expect(await nextMatching(iter, "hello v1")).toContain("hello v1");

      writeFileSync(fooPath, `console.log("hello v2");\n`);
      expect(await nextMatching(iter, "hello v2")).toContain("hello v2");

      // Break it — the plugin should throw, and the watcher must keep
      // tracking foo.js so that fixing it reloads again.
      writeFileSync(fooPath, `BAD; console.log("hello v3");\n`);
      expect(await nextMatching(iter, "PLUGIN-ERROR")).toContain("PLUGIN-ERROR");

      writeFileSync(fooPath, `console.log("hello v4");\n`);
      expect(await nextMatching(iter, "hello v4")).toContain("hello v4");

      proc.kill();
      await proc.exited;
    }, 15000);
  },
);
