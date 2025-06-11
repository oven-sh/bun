import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import stripAnsi from "strip-ansi";

const IS_CHILD = process.env.IS_CHILD === "true";

if (IS_CHILD) {
  const worker = new Worker("process.exit(1)", { eval: true });
  worker.on("exit", code => console.log(code));
} else {
  test("The worker exit event is emitted before the parent exits", async () => {
    const file = fileURLToPath(import.meta.url);

    const { stdout } = spawnSync(process.execPath, [file], {
      env: { ...process.env, IS_CHILD: "true" },
    });

    assert.strictEqual(stripAnsi(stdout.toString()).trim(), "1");
  });
}
