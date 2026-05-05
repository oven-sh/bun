import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// When a proxy CONNECT 200 response is split across TCP reads and arrives
// with trailing upstream bytes (the start of the 101 Switching Protocols
// reply), handleProxyResponse computed `remain_buf` as a slice into
// `this.body`'s retained capacity, cleared the ArrayList, then re-entered
// handleData which appendSlice'd that aliased slice back into `this.body`
// — "@memcpy arguments alias" panic in safe builds, UB in release.
test("ws:// through proxy: split CONNECT reply with trailing bytes does not alias body buffer", async () => {
  // Clear proxy env vars so `Bun__isNoProxy` doesn't bypass the explicit
  // proxy option (CI containers set NO_PROXY=127.0.0.1 which would make the
  // client dial the fake target directly and fail to connect).
  const env = { ...bunEnv };
  for (const k of ["NO_PROXY", "no_proxy", "HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"]) delete env[k];

  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "websocket-proxy-split-connect-fixture.ts")],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) console.error(stderr);
  expect(stdout).toBe("OK\n");
  expect(exitCode).toBe(0);
});
