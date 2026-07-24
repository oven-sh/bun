import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test.concurrent("runtime plugin with object loader supports default import", async () => {
  using dir = tempDir("issue-9987", {
    "preload.ts": `
import { plugin } from "bun";
plugin({
  name: "yaml-loader",
  setup(build) {
    build.onLoad({ filter: /\\.yaml$/ }, async (args) => {
      const text = await Bun.file(args.path).text();
      const lines = text.split("\\n").filter(Boolean);
      const exports: Record<string, string> = {};
      for (const line of lines) {
        const [key, value] = line.split(": ");
        exports[key.trim()] = value.trim();
      }
      return { exports, loader: "object" };
    });
  },
});
`,
    "data.yaml": `name: test\nvalue: 42`,
    "main.ts": `
import data from "./data.yaml";
import { name, value } from "./data.yaml";
console.log(JSON.stringify(data));
console.log(name);
console.log(value);
`,
    "bunfig.toml": `preload = ["./preload.ts"]`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("SyntaxError");
  const lines = stdout.trim().split("\n");
  expect(lines[0]).toBe('{"name":"test","value":"42"}');
  expect(lines[1]).toBe("test");
  expect(lines[2]).toBe("42");
  expect(exitCode).toBe(0);
});

test.concurrent("runtime plugin with object loader preserves explicit default export", async () => {
  using dir = tempDir("issue-9987-default", {
    "preload.ts": `
import { plugin } from "bun";
plugin({
  name: "custom-loader",
  setup(build) {
    build.onLoad({ filter: /\\.custom$/ }, async (args) => {
      return {
        exports: { default: "my-default", named: "my-named" },
        loader: "object",
      };
    });
  },
});
`,
    "data.custom": `placeholder`,
    "main.ts": `
import data, { named } from "./data.custom";
console.log(data);
console.log(named);
`,
    "bunfig.toml": `preload = ["./preload.ts"]`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("SyntaxError");
  const lines = stdout.trim().split("\n");
  expect(lines[0]).toBe("my-default");
  expect(lines[1]).toBe("my-named");
  expect(exitCode).toBe(0);
});
