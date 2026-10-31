import { expect, test } from "bun:test";
import { blackholePortSource, bunEnv, bunExe, isMusl, isWindows } from "harness";

// Binds `url`, where connect() returns EINPROGRESS and never completes. blackholePortSource
// doesn't support Windows or musl, so those still dial TEST-NET-1 (RFC 5737).
const setup =
  isWindows || isMusl
    ? `const url = "http://192.0.2.1:80/", filler = { destroy() {} };`
    : `${blackholePortSource}const url = "http://127.0.0.1:" + port + "/";`;

async function fetchWhileConnecting(signal: string): Promise<{ name: string; elapsed: number }> {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `${setup}
      const start = performance.now();
      const name = await fetch(url, { signal: ${signal} }).then(() => "resolved", e => e.name);
      console.log(JSON.stringify({ name, elapsed: performance.now() - start }));
      filler.destroy();`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return JSON.parse(stdout);
}

test.concurrent("fetch aborts when connect() returns EINPROGRESS but never completes", async () => {
  const { name, elapsed } = await fetchWhileConnecting("AbortSignal.timeout(50)");
  expect(name).toBe("TimeoutError");
  expect(elapsed).toBeLessThan(1000);
});

test.concurrent("fetch aborts immediately during EINPROGRESS connect", async () => {
  const { name, elapsed } = await fetchWhileConnecting("AbortSignal.timeout(1)");
  expect(name).toBe("TimeoutError");
  expect(elapsed).toBeLessThan(1000);
});

test.concurrent("pre-aborted signal prevents connection attempt", async () => {
  const start = performance.now();
  try {
    // Nothing listens on port 1, so a connection attempt would fail with ECONNREFUSED instead.
    await fetch("http://127.0.0.1:1/", {
      signal: AbortSignal.abort(),
    });
    expect.unreachable("Fetch should have aborted");
  } catch (e: any) {
    const elapsed = performance.now() - start;
    expect(e.name).toBe("AbortError");
    expect(elapsed).toBeLessThan(10); // Should fail immediately
  }
});
