import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("async transform() parse errors do not read freed arena memory", async () => {
  const script = `
    const t = new Bun.Transpiler();
    const promises = [];
    for (let i = 0; i < 200; i++) {
      promises.push(t.transform("@@", "js"));
    }
    const results = await Promise.allSettled(promises);
    for (const r of results) {
      if (r.status !== "rejected") throw new Error("expected rejection");
      if (!String(r.reason).includes("@")) throw new Error("expected message, got: " + String(r.reason));
    }
    console.log("ok", results.length);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: {
      ...bunEnv,
      MIMALLOC_PURGE_DELAY: "0",
      MIMALLOC_PAGE_RECLAIM_ON_FREE: "0",
      UV_THREADPOOL_SIZE: "2",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("ok 200");
  expect(exitCode).toBe(0);
});
