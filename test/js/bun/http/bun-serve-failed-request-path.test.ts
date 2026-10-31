import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The servers here fail on purpose and Bun reports each failure on stderr, so each case runs in a
// subprocess that prints what the client saw as JSON.
async function run(script: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, NODE_ENV: undefined },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout, stderr).not.toBe("");
  return { result: JSON.parse(stdout), stderr };
}

test("the failed-request line names the path once the request went async", async () => {
  const { result, stderr } = await run(/* js */ `
    const server = Bun.serve({
      port: 0,
      development: true,
      fetch(req) {
        return req.url.endsWith("sync") ? (() => { throw new Error("sync"); })() : new Promise((_, reject) => setTimeout(() => reject(new Error("late")), 5));
      },
    });
    const statuses = [];
    for (const path of ["/q?x=1", "/q?x=2&sync"]) statuses.push((await fetch("http://localhost:" + server.port + path)).status);
    server.stop(true);
    console.log(JSON.stringify(statuses));
  `);
  expect(result).toEqual([500, 500]);
  expect(stderr).toContain("GET - /q?x=2&sync failed");
  expect(stderr).toContain("GET - /q?x=1 failed");
  expect(stderr).not.toContain("GET - http://");
});
