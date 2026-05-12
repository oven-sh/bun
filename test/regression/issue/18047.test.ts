// https://github.com/oven-sh/bun/issues/18047
// Calling a macro as a tagged template literal used to panic with
// "TODO: support template literals in macros".
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("bun build: macro called as tagged template literal", async () => {
  using dir = tempDir("issue-18047", {
    "macro.ts": `
      export const ico = (name: TemplateStringsArray) => \`/svg/spritesheet.svg#\${name[0]}\`;
      export const tag = (strings: TemplateStringsArray, ...values: any[]) =>
        JSON.stringify({ cooked: [...strings], raw: [...strings.raw], values });
    `,
    "index.ts": `
      import { ico, tag } from "./macro" with { type: "macro" };
      console.log(ico\`hello\`);
      console.log(tag\`a\${1}b\${true}c\`);
      console.log(tag\`line1\\nline2\`);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toContain('console.log("/svg/spritesheet.svg#hello")');
  expect(stdout).toContain(
    'console.log(\'{"cooked":["a","b","c"],"raw":["a","b","c"],"values":[1,true]}\')',
  );
  // cooked has a real newline (\n in JSON); raw has backslash-n (\\n in JSON)
  expect(stdout).toContain(
    'console.log(\'{"cooked":["line1\\\\nline2"],"raw":["line1\\\\\\\\nline2"],"values":[]}\')',
  );
  expect(exitCode).toBe(0);
});

test("bun run: macro called as tagged template literal", async () => {
  using dir = tempDir("issue-18047-run", {
    "macro.ts": `
      export const ico = (name: TemplateStringsArray) => \`/svg/spritesheet.svg#\${name[0]}\`;
    `,
    "index.ts": `
      import { ico } from "./macro" with { type: "macro" };
      console.log(ico\`hello\`);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "./index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  // Debug builds print "[macro] call <name>" to stdout; only check the script output.
  expect(stdout).toEndWith("/svg/spritesheet.svg#hello\n");
  expect(exitCode).toBe(0);
});
