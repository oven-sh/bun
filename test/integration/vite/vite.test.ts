import { describe, test, expect } from "bun:test";
import { spawn } from "bun";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, mkdtempSync } from "node:fs";
import { bunExe, bunEnv } from "harness";

describe.each([
  "vanilla",
  "vanilla-ts",
  "vue-ts",
  "react-ts",
  "preact-ts",
  "lit-ts",
  "svelte-ts",
  "solid-ts",
  "qwik-ts",
])("vite/%s", (template: string) => {
  const tmp = mkdtempSync(join(tmpdir(), `vite-${template}-`));
  const cwd = join(tmp, template);
  console.log(`vite/${template}`, "->", cwd);

  test(
    "bun create",
    async () => {
      const { exited } = spawn({
        cwd: tmp,
        cmd: [bunExe(), "create", "vite", template, "--template", template],
        env: bunEnv,
        stdout: "ignore",
        stderr: "inherit",
      });
      expect(exited).resolves.toBe(0);
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
      const { exited } = spawn({
        cwd,
        cmd: [bunExe(), "install"],
        env: bunEnv,
        stdout: "inherit",
        stderr: "inherit",
      });
      expect(exited).resolves.toBe(0);
      expect(existsSync(join(cwd, "bun.lockb"))).toBeTrue();
    },
    {
      timeout: 15_000,
    },
  );

  test(
    "bun run dev",
    async () => {
      const { exited, stdout } = spawn({
        cwd,
        cmd: [bunExe(), "--bun", "run", "dev", "--port", "0"],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });

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
        throw new Error("Failed to find URL in stdout");
      }

      const response = await fetch(url);
      const body = await response.text();

      const sanitizedBody = body
        .replaceAll(cwd, "")
        .replace(/localhost:\d+/gim, "localhost")
        .replace(/v\d+\.\d+\.\d+/gim, "v1.0.0");
      expect(sanitizedBody).toMatchSnapshot();
      expect(response.status).toBe(200);
    },
    {
      timeout: 15_000,
    },
  );
});
