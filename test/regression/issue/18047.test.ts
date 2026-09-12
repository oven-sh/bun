// https://github.com/oven-sh/bun/issues/18047
// Calling a macro as a tagged template literal used to panic because the
// e_template caller case in Macro.Runner.run was unimplemented.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const macroSource = `
  export const ico = (name) => "/svg/spritesheet.svg#" + name[0];
  export const tag = (strings, ...values) => {
    const cooked = [];
    for (const s of strings) cooked.push(s);
    return JSON.stringify({ cooked, raw: [...strings.raw], values });
  };
`;

test("bun build: macro called as tagged template literal", async () => {
  using dir = tempDir("issue-18047", {
    "macro.ts": macroSource,
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
  expect(stdout).toContain('console.log(\'{"cooked":["a","b","c"],"raw":["a","b","c"],"values":[1,true]}\')');
  // cooked has a real newline (\n in JSON); raw has backslash-n (\\n in JSON)
  expect(stdout).toContain('console.log(\'{"cooked":["line1\\\\nline2"],"raw":["line1\\\\\\\\nline2"],"values":[]}\')');
  expect(exitCode).toBe(0);
});

test("bun run: macro called as tagged template literal", async () => {
  using dir = tempDir("issue-18047-run", {
    "macro.ts": macroSource,
    "index.ts": `
      import { ico, tag } from "./macro" with { type: "macro" };
      import * as macros from "./macro" with { type: "macro" };
      const check = (label, got, want) => {
        const s = JSON.stringify(got);
        if (s !== JSON.stringify(want)) throw new Error(label + ": " + s);
        console.log(label, "ok");
      };
      check("no-subst", ico\`hello\`, "/svg/spritesheet.svg#hello");
      check("namespace", macros.ico\`world\`, "/svg/spritesheet.svg#world");
      check("subst", JSON.parse(tag\`a\${1}b\${"two"}c\`),
        { cooked: ["a","b","c"], raw: ["a","b","c"], values: [1,"two"] });
      check("fold", JSON.parse(tag\`x\${1 + 2}y\${\`nested\${0}template\`}z\`),
        { cooked: ["x","y","z"], raw: ["x","y","z"], values: [3,"nested0template"] });
      check("escapes", JSON.parse(tag\`line1\\nline2\`),
        { cooked: ["line1\\nline2"], raw: ["line1\\\\nline2"], values: [] });
      check("escapes2", JSON.parse(tag\`\\t\\r\\n\\\\\\\`\`),
        { cooked: ["\\t\\r\\n\\\\\`"], raw: ["\\\\t\\\\r\\\\n\\\\\\\\\\\\\`"], values: [] });
      check("unicode", JSON.parse(tag\`\\u{1F600}\`),
        { cooked: ["\u{1F600}"], raw: ["\\\\u{1F600}"], values: [] });
      check("line-cont", JSON.parse(tag\`\\\n\${1}rest\`),
        { cooked: ["","rest"], raw: ["\\\\\\n","rest"], values: [1] });
      check("invalid-escape", JSON.parse(tag\`\\unicode\`),
        { cooked: [null], raw: ["\\\\unicode"], values: [] });
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
  expect(stdout).toContain("no-subst ok");
  expect(stdout).toContain("namespace ok");
  expect(stdout).toContain("subst ok");
  expect(stdout).toContain("fold ok");
  expect(stdout).toContain("escapes ok");
  expect(stdout).toContain("escapes2 ok");
  expect(stdout).toContain("unicode ok");
  expect(stdout).toContain("line-cont ok");
  expect(stdout).toContain("invalid-escape ok");
  expect(exitCode).toBe(0);
});
