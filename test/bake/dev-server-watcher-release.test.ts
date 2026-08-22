// https://github.com/oven-sh/bun/issues/21017

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import path from "node:path";

const fixtureDir = path.join(import.meta.dir, "fixtures", "watcher-release");
const fixtureFiles = ["dev-server-teardown-fixture.ts", "index.html", "entry.ts"];

test("tearing down a dev server also tears down its watcher thread", async () => {
  // The fixture modifies one of its own files, so it runs from a scratch copy.
  using dir = tempDir(
    "watcher-release",
    Object.fromEntries(
      await Promise.all(fixtureFiles.map(async name => [name, await Bun.file(path.join(fixtureDir, name)).text()])),
    ),
  );
  using traceDir = tempDir("watcher-release-trace", {});

  await using proc = Bun.spawn({
    cmd: [bunExe(), fixtureFiles[0]],
    env: { ...bunEnv, BUN_WATCHER_TRACE: path.join(String(traceDir), "trace.log") },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr }).toEqual({
    stdout: expect.stringContaining("PASS"),
    stderr: expect.anything(),
  });

  if (isLinux) {
    // Without the fix every dev server leaves one parked watcher thread and one
    // inotify instance behind: 20 for the listen failures and 5 for the served
    // servers. The deltas can dip below zero when a thread from an earlier
    // teardown exits inside a measured window, and unrelated threads may
    // appear, hence bounds rather than exact values.
    const result = JSON.parse(stdout.split("\n").find(line => line.startsWith("{"))!);
    expect(result).toEqual({
      listenFail: { threads: expect.any(Number), inotify: expect.any(Number) },
      served: { threads: expect.any(Number), inotify: expect.any(Number) },
      survivorTraced: true,
    });
    expect(result.listenFail.inotify).toBeLessThanOrEqual(0);
    expect(result.listenFail.threads).toBeLessThan(10);
    expect(result.served.inotify).toBeLessThanOrEqual(0);
    expect(result.served.threads).toBeLessThan(3);
  }

  expect(exitCode).toBe(0);
});
