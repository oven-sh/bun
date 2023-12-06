import { describe, test, expect, afterEach } from "bun:test";
import { PipedSubprocess, Subprocess, spawn } from "bun";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, mkdtempSync } from "node:fs";
import { bunExe, bunEnv, randomPort } from "harness";

describe.each(["vanilla", "vanilla-ts", "react", "react-ts"])("vite/%s", (template: string) => {
  const tmp = mkdtempSync(join(tmpdir(), `vite-${template}-`));
  const cwd = join(tmp, template);

  let subprocess: Subprocess | undefined;

  afterEach(() => {
    subprocess?.kill();
  });

  test(
    "bunx create-vite",
    async () => {
      subprocess = spawn({
        cwd: tmp,
        cmd: [bunExe(), "--bun", "x", "create-vite", template, "--template", template],
        env: bunEnv,
        stdout: "inherit",
        stderr: "inherit",
      });
      expect(subprocess.exited).resolves.toBe(0);
      expect(existsSync(cwd)).toBeTrue();
      expect(existsSync(join(cwd, "package.json"))).toBeTrue();
    },
    {
      timeout: 15_000,
    },
  );

  test(
    "bun install",
    async () => {
      subprocess = spawn({
        cwd,
        cmd: [bunExe(), "install"],
        env: bunEnv,
        stdout: "inherit",
        stderr: "inherit",
      });
      expect(subprocess.exited).resolves.toBe(0);
      expect(existsSync(join(cwd, "bun.lockb"))).toBeTrue();
      expect(existsSync(join(cwd, "node_modules"))).toBeTrue();
    },
    {
      timeout: 15_000,
    },
  );

  test("bun run build", () => {
    subprocess = spawn({
      cwd,
      cmd: [bunExe(), "--bun", "run", "build"],
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    });
    expect(subprocess.exited).resolves.toBe(0);
    expect(existsSync(join(cwd, "dist"))).toBeTrue();
    expect(existsSync(join(cwd, "dist", "index.html"))).toBeTrue();
  });

  test.each(["preview", "dev"])(
    "bun run %s",
    async subcommand => {
      subprocess = spawn({
        cwd,
        cmd: [bunExe(), "--bun", "run", subcommand, "--port", `${randomPort()}`, "--strict-port", "true"],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });
      const { stdout } = subprocess as PipedSubprocess;

      let url: string | undefined;
      for await (const chunk of stdout) {
        process.stdout.write(chunk);
        const text = Buffer.from(chunk).toString();
        const match = text.match(/(http:\/\/[^\s]+)/gim);
        if (match?.length) {
          url = match[0];
          break;
        }
      }
      if (!url) {
        throw new Error("Failed to find server URL from stdout");
      }

      for (let i = 0; i < 100; i++) {
        const response = await fetch(url);
        expect(response.text()).resolves.toStartWith("<!doctype html>");
        expect(response.status).toBe(200);
      }
    },
    {
      timeout: 60_000,
    },
  );
});
