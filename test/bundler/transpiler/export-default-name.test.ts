import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("anonymous export default .name", () => {
  test.concurrent.each([
    ["function", "export default function () {}"],
    ["async function", "export default async function () {}"],
    ["function*", "export default function* () {}"],
    ["async function*", "export default async function* () {}"],
    ["class", "export default class {}"],
    ["arrow", "export default () => 1;"],
  ])("%s: .name is 'default'", async (_label, decl) => {
    using dir = tempDir("export-default-name", {
      "mod.mjs": `${decl}\nimport self from "./mod.mjs";\nconsole.log(JSON.stringify(self.name));\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "mod.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: '"default"\n', stderr: "", exitCode: 0 });
  });

  test.concurrent("named function keeps its own name", async () => {
    using dir = tempDir("export-default-named", {
      "mod.mjs": `export default function Foo() {}\nimport self from "./mod.mjs";\nconsole.log(JSON.stringify(self.name));\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "mod.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: '"Foo"\n', stderr: "", exitCode: 0 });
  });
});
