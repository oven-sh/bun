import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { symlinkSync } from "node:fs";
import path from "node:path";

// Extracts ```<lang> <filename> ...``` fenced code blocks from an .mdx guide.
function extractCodeBlocks(mdx: string): Record<string, string> {
  const blocks: Record<string, string> = {};
  const re = /^```(\w+)\s+([^\s]+)[^\n]*\n([\s\S]*?)^```/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(mdx))) {
    blocks[m[2]] = m[3];
  }
  return blocks;
}

// Validates that the code in docs/guides/test/svelte-test.mdx actually works:
// the preloaded plugin compiles the example component and the happy-dom
// registration makes `document` available. Guards against the guide being
// broken by docs tooling (it previously shipped with an invalid compile
// option and mangled Svelte markup).
test("docs/guides/test/svelte-test.mdx: loader + happy-dom preload compiles the example component", async () => {
  const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
  const guidePath = path.join(repoRoot, "docs", "guides", "test", "svelte-test.mdx");
  const mdx = await Bun.file(guidePath).text();
  const blocks = extractCodeBlocks(mdx);

  expect(blocks["svelte-loader.ts"]).toBeString();
  expect(blocks["bunfig.toml"]).toBeString();
  expect(blocks["Counter.svelte"]).toBeString();

  using dir = tempDir("svelte-test-guide", {
    "svelte-loader.ts": blocks["svelte-loader.ts"],
    "bunfig.toml": blocks["bunfig.toml"],
    "Counter.svelte": blocks["Counter.svelte"],
    "package.json": JSON.stringify({ name: "svelte-test-guide", type: "module" }),
    "guide-smoke.test.ts": `
      import { test, expect } from "bun:test";
      import Counter from "./Counter.svelte";

      test("the guide's loader compiles Counter.svelte and happy-dom is registered", () => {
        expect(typeof Counter).toBe("function");
        expect(typeof document).toBe("object");
        expect(document.createElement("div").tagName).toBe("DIV");
      });
    `,
  });

  symlinkSync(path.join(repoRoot, "test", "node_modules"), path.join(String(dir), "node_modules"), "junction");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "guide-smoke.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const output = `${stdout}\n${stderr}`;

  expect(output).toContain("1 pass");
  expect(output).not.toContain("fail)");
  expect(exitCode).toBe(0);
}, 60_000);
