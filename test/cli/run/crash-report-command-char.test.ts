import { describe, expect, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  isAndroid,
  isArm64,
  isFreeBSD,
  isMacOS,
  isMusl,
  isWindows,
  mergeWindowEnvs,
  tempDir,
} from "harness";
import path from "path";

// The fixed-position header of the trace string. bun.report's decoder reads it
// positionally, so these characters are part of the wire format.

// Crash while running the given arguments and return the payload of the trace
// string printed to stderr:
//   {base}/{version}/{platform char}{command char}{remainder}
async function traceStringPayloadFromCrash(args: string[]): Promise<string> {
  using server = Bun.serve({ port: 0, fetch: () => new Response("OK") });
  const base = new URL(server.url).origin;

  // No cwd override: on Windows the crash reporter spawns a detached child
  // that inherits the crashing process's cwd, which would keep a tempDir
  // cwd alive past the test and make its cleanup fail with EBUSY.
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: mergeWindowEnvs([
      bunEnv,
      {
        BUN_CRASH_REPORT_URL: base,
        BUN_ENABLE_CRASH_REPORTING: "1",
      },
    ]),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(exitCode).not.toBe(0);

  const trace = stderr.match(new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\S+`));
  expect(trace).not.toBeNull();
  const payload = new URL(trace![0]).pathname.split("/")[2];
  expect(payload.length).toBeGreaterThan(2);
  return payload;
}

const fixture = path.join(import.meta.dir, "fixture-crash.js");

describe.concurrent("crash report platform character", () => {
  // Must stay in sync with `Platform::CURRENT` (src/crash_handler/lib.rs) and
  // bun.report's `platform_map`. bun.report downloads the debug file of the
  // build this character names, so the glibc, musl and android builds of one
  // commit (three different binaries) each need their own character. Through
  // 1.4.0 the musl and android builds reported the glibc character, and every
  // crash report from them was symbolicated against the glibc binary.
  const expectedLowercase = isWindows ? "w" : isMacOS ? "m" : isFreeBSD ? "f" : isAndroid ? "a" : isMusl ? "u" : "l";
  const expected = isArm64 ? expectedLowercase.toUpperCase() : expectedLowercase;

  test(`encodes this build as '${expected}'`, async () => {
    const payload = await traceStringPayloadFromCrash([fixture, "panic"]);
    expect(payload[0]).toBe(expected);
  });
});

describe.concurrent("crash report command character", () => {
  // Expected characters must stay in sync with `Command.Tag.char()`
  // (src/options_types/command_tag.rs) and bun.report's decoder.
  async function commandCharFromCrash(args: string[]): Promise<string> {
    return (await traceStringPayloadFromCrash(args))[1];
  }

  test("bun <script> encodes AutoCommand", async () => {
    expect(await commandCharFromCrash([fixture, "panic"])).toBe("a");
  });

  test("bun run <script> encodes RunCommand", async () => {
    expect(await commandCharFromCrash(["run", fixture, "panic"])).toBe("r");
  });

  test("bun test encodes TestCommand", async () => {
    using dir = tempDir("crash-report-cmd-char", {
      "crash.fixture.test.js": `
        import { crash_handler } from "bun:internal-for-testing";
        crash_handler.panic();
      `,
    });
    const testFile = path.join(String(dir), "crash.fixture.test.js");
    expect(await commandCharFromCrash(["test", testFile])).toBe("t");
  });
});
