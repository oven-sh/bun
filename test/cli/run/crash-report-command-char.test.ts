import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, mergeWindowEnvs, tempDir } from "harness";
import path from "path";

// NOTE: kept separate from run-crash-handler.test.ts on purpose — that file
// is skip-listed in test/expectations.txt (its segfault-reporter test is
// broken), so anything added there never runs in CI.
describe.concurrent("crash report command character", () => {
  // Crash while a given subcommand is running and return the command
  // character from the trace string printed to stderr:
  //   {base}/{version}/{platform char}{command char}{remainder}
  // Expected characters must stay in sync with `Command.Tag.char()`
  // (src/options_types/command_tag.rs) and bun.report's decoder.
  async function commandCharFromCrash(args: string[]): Promise<string> {
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
    return payload[1];
  }

  const fixture = path.join(import.meta.dir, "fixture-crash.js");

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
