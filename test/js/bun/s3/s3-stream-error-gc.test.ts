import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The error stored on a ByteStream's pending result must be GC-rooted between
// stream() failing and .text()/.bytes() reading it. Without a root, the error
// object is collected and the later promise rejection dereferences a freed cell.
test("S3 stream error should survive GC before consumption", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const stream = Bun.S3Client.file("test").stream();
        Bun.gc(true);
        stream.text().then(
          () => console.log("unexpected resolve"),
          (e) => console.log("rejected", e?.code),
        );
      `,
    ],
    env: {
      ...bunEnv,
      BUN_JSC_slowPathAllocsBetweenGCs: "5",
      S3_ACCESS_KEY_ID: undefined,
      AWS_ACCESS_KEY_ID: undefined,
      S3_SECRET_ACCESS_KEY: undefined,
      AWS_SECRET_ACCESS_KEY: undefined,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), exitCode }).toEqual({
    stdout: "rejected ERR_S3_MISSING_CREDENTIALS",
    exitCode: 0,
  });
});
