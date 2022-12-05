import { spawnSync, spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunExe } from "bunExe";

describe("should work for static input", () => {
  const inputs = [
    "hello world",
    "hello world\n",
    "hello world\n\n",
    "hello world\n\n\n",
    "Hello\nWorld\n",
    "1",
    "❤️ Red Heart ✨ Sparkles 🔥 Fire\n❤️ Red Heart ✨ Sparkles\n❤️ Red Heart\n❤️\n\nnormal",
  ];

  for (let input of inputs) {
    it(input.replaceAll("\n", "\\n"), () => {
      const { stdout } = spawnSync({
        cmd: [bunExe(), import.meta.dir + "/" + "console-iterator-run.js"],
        stdin: Buffer.from(input),
        env: {
          BUN_DEBUG_QUIET_LOGS: "1",
        },
      });
      expect(stdout.toString()).toBe(input.replaceAll("\n", ""));
    });
  }
});

describe("should work for streaming input", () => {
  const inputs = [
    "hello world",
    "hello world\n",
    "hello world\n\n",
    "hello world\n\n\n",
    "Hello\nWorld\n",
    "1",
    "❤️ Red Heart ✨ Sparkles 🔥 Fire\n❤️ Red Heart ✨ Sparkles\n❤️ Red Heart\n❤️\n\nnormal",
  ];

  for (let input of inputs) {
    it(input.replaceAll("\n", "\\n"), async () => {
      const { stdout, stdin } = spawn({
        cmd: [bunExe(), import.meta.dir + "/" + "console-iterator-run.js"],
        stdin: "pipe",
        stdout: "pipe",
        env: {
          BUN_DEBUG_QUIET_LOGS: "1",
        },
      });
      stdin.write(input.slice(0, 4));
      await new Promise((resolve) => setTimeout(resolve, 1));
      stdin.write(input.slice(4, 5));
      await new Promise((resolve) => setTimeout(resolve, 1));
      stdin.write(input.slice(5));
      await new Promise((resolve) => setTimeout(resolve, 1));
      stdin.end();

      expect(await new Response(stdout).text()).toBe(
        input.replaceAll("\n", ""),
      );
    });
  }
});
