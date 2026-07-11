// When the OS refuses to create the HTTP client thread (Windows CreateThread
// failing under commit-limit pressure or sandbox/AV denial is the common case
// in crash reports), fetch() should reject with a catchable error instead of
// panicking the whole process.
//
// Sentry: BUN-2V2S "Failed to start HTTP Client thread: Unexpected"
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";

// There is no portable way to force CreateThread/pthread_create to fail
// deterministically in CI, so exercise the same error path via the
// BUN_INTERNAL_FAIL_HTTP_THREAD_SPAWN hook (shares the code path with a real
// spawn failure: init() latches the io::Error and every HTTP entry point
// observes it). The hook is compiled out of release builds
// (cfg!(debug_assertions) gate in HTTPThread.rs), so these tests only run
// against debug binaries.
const failEnv = {
  ...bunEnv,
  BUN_INTERNAL_FAIL_HTTP_THREAD_SPAWN: "1",
};

async function run(src: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: failEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent.skipIf(!isDebug)("fetch() when the HTTP client thread cannot be spawned", () => {
  test("rejects with a TypeError containing the OS error instead of panicking", async () => {
    const { stdout, stderr, exitCode } = await run(/* js */ `
      let err;
      try {
        await fetch("http://127.0.0.1:1/");
        console.log("UNEXPECTED: fetch resolved");
      } catch (e) {
        err = e;
      }
      if (!err) {
        console.log("UNEXPECTED: fetch did not reject");
        process.exit(1);
      }
      console.log(JSON.stringify({
        name: err?.name,
        message: String(err?.message ?? ""),
        isTypeError: err instanceof TypeError,
      }));
    `);

    // On the unfixed build the env var is unknown, so the HTTP thread starts
    // normally and fetch rejects with ConnectionRefused (different message),
    // or the process aborts via Output::panic if spawn genuinely fails.
    let parsed;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      throw new Error(`child did not emit JSON; stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`);
    }
    expect(parsed).toEqual({
      name: "TypeError",
      isTypeError: true,
      message: expect.stringContaining("Failed to start HTTP Client thread"),
    });
    // io::Error Display includes "(os error N)" on Windows and POSIX; this
    // is the diagnosability half of the fix.
    expect(parsed.message).toMatch(/os error \d+/);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("subsequent fetch() calls observe the same latched failure", async () => {
    const { stdout, stderr, exitCode } = await run(/* js */ `
      const msgs = [];
      for (let i = 0; i < 3; i++) {
        try {
          await fetch("http://127.0.0.1:1/");
          msgs.push("resolved");
        } catch (e) {
          msgs.push(String(e?.message ?? e));
        }
      }
      console.log(JSON.stringify(msgs));
    `);

    let msgs;
    try {
      msgs = JSON.parse(stdout.trim());
    } catch {
      throw new Error(`child did not emit JSON; stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`);
    }
    expect(msgs).toEqual([
      expect.stringContaining("Failed to start HTTP Client thread"),
      expect.stringContaining("Failed to start HTTP Client thread"),
      expect.stringContaining("Failed to start HTTP Client thread"),
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("fetch.preconnect() falls through without crashing and fetch() still surfaces the error", async () => {
    const { stdout, stderr, exitCode } = await run(/* js */ `
      fetch.preconnect("http://127.0.0.1:1/");
      fetch.preconnect("http://127.0.0.1:1/");
      let msg = "none";
      try {
        await fetch("http://127.0.0.1:1/");
      } catch (e) {
        msg = String(e?.message ?? e);
      }
      console.log(JSON.stringify({ msg }));
    `);

    let parsed;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      throw new Error(`child did not emit JSON; stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`);
    }
    expect(parsed).toEqual({
      msg: expect.stringContaining("Failed to start HTTP Client thread"),
    });
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("S3 operations surface the failure as an error instead of panicking", async () => {
    const { stdout, stderr, exitCode } = await run(/* js */ `
      const client = new Bun.S3Client({
        accessKeyId: "x",
        secretAccessKey: "y",
        bucket: "b",
        endpoint: "http://127.0.0.1:1",
      });
      try {
        await client.list();
        console.log(JSON.stringify({ message: "UNEXPECTED: list resolved" }));
      } catch (e) {
        console.log(JSON.stringify({
          message: String(e?.message ?? ""),
        }));
      }
    `);

    let parsed;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      throw new Error(`child did not emit JSON; stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`);
    }
    expect(parsed).toEqual({
      message: expect.stringContaining("Failed to start HTTP Client thread"),
    });
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});
