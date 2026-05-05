// https://github.com/oven-sh/bun/issues/30273
//
// setTimeout is starved while a synchronous node:http client burst is in
// flight: a `Promise.all` fan-out of AWS SDK calls (which chain deep
// middleware per response) keeps the JS thread inside the task-drain loop,
// so `drainTimers` never runs until the burst drains. The fix drains expired
// timers between tasks in `tickQueueWithCount` so a continuous stream of
// concurrent completions doesn't block `setTimeout`/`setInterval`.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";

test(
  "setTimeout fires early in a node:http + @aws-sdk burst",
  async () => {
    // In release each SDK call is ~0.4 ms, so we need a few thousand to push
    // `burstEnd` well past the 200ms timer target and make the pre-fix
    // starvation visible. In ASAN debug each call is ~50 ms, so a small N is
    // plenty and more would blow the test budget.
    const N = isDebug ? 100 : 10000;

    using dir = tempDir("issue-30273", {
      "package.json": JSON.stringify({
        name: "repro",
        type: "module",
        dependencies: {
          "@aws-sdk/client-dynamodb": "3.744.0",
        },
      }),
      "repro.ts": `
import { createServer } from "node:http";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";

const LATENCY_MS = 50;
const TIMER_MS = 200;
const N = Number(process.env.N);

const server = createServer((req, res) => {
  req.on("data", () => {});
  req.on("end", () => {
    setTimeout(() => {
      const body = "{}";
      res.writeHead(200, {
        "content-type": "application/x-amz-json-1.0",
        "content-length": Buffer.byteLength(body),
      });
      res.end(body);
    }, LATENCY_MS);
  });
});
const { promise: listening, resolve: listenResolve } =
  Promise.withResolvers();
server.listen(0, () => listenResolve(server.address().port));
const port = await listening;

const client = new DynamoDBClient({
  region: "us-east-1",
  endpoint: \`http://127.0.0.1:\${port}\`,
  credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
  maxAttempts: 1,
});

const t0 = performance.now();
const timerFired = Promise.withResolvers();
setTimeout(() => timerFired.resolve(performance.now() - t0), TIMER_MS);

await Promise.all(
  Array.from({ length: N }, (_, i) =>
    client
      .send(new PutItemCommand({ TableName: "T", Item: { pk: { S: \`k-\${i}\` } } }))
      .catch(() => undefined),
  ),
);
const firedAt = await timerFired.promise;
const burstEnd = performance.now() - t0;

console.log(JSON.stringify({ TIMER_MS, burstEnd, firedAt }));
server.close();
client.destroy();
`,
    });

    // Install the SDK (no lockfile, no scripts for speed).
    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install", "--no-save", "--ignore-scripts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, installStderr, installExit] = await Promise.all([
      installProc.stdout.text(),
      installProc.stderr.text(),
      installProc.exited,
    ]);
    if (installExit !== 0) {
      console.log("install stderr:", installStderr);
    }
    expect(installExit).toBe(0);

    // Run the reproduction.
    await using runProc = Bun.spawn({
      cmd: [bunExe(), "run", "repro.ts"],
      cwd: String(dir),
      env: { ...bunEnv, N: String(N) },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      runProc.stdout.text(),
      runProc.stderr.text(),
      runProc.exited,
    ]);
    if (exitCode !== 0) {
      console.log("run stdout:", stdout);
      console.log("run stderr:", stderr);
    }
    expect(exitCode).toBe(0);

    const line = stdout.trim().split("\n").at(-1)!;
    const { TIMER_MS, burstEnd, firedAt } = JSON.parse(line) as {
      TIMER_MS: number;
      burstEnd: number;
      firedAt: number;
    };

    // Sanity: the burst must span well past the timer target, otherwise the
    // test is just observing `setTimeout` firing under no load.
    expect(burstEnd).toBeGreaterThan(1000);

    // Timers never fire before their target.
    expect(firedAt).toBeGreaterThanOrEqual(TIMER_MS);

    // With the fix the timer fires very close to its target. Before the fix
    // it fires at ~36–40% of burstEnd (fraction scales with burst size).
    // Asserting that firedAt is below 25% of burstEnd cleanly separates the
    // two regimes in both debug and release builds.
    expect(firedAt).toBeLessThan(burstEnd * 0.25);
  },
  120_000,
);
