import { crash_handler } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, mergeWindowEnvs } from "harness";
import path from "path";
const { getMachOImageZeroOffset } = crash_handler;

test.if(process.platform === "darwin")("macOS has the assumed image offset", () => {
  // If this fails, then https://bun.report will be incorrect and the stack
  // trace remappings will stop working.
  expect(getMachOImageZeroOffset()).toBe(0x100000000);
});

test("raise ignoring panic handler does not trigger the panic handler", async () => {
  let sent = false;
  const resolve_handler = Promise.withResolvers();

  using server = Bun.serve({
    port: 0,
    fetch(request, server) {
      sent = true;
      resolve_handler.resolve();
      return new Response("OK");
    },
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "fixture-crash.js"), "raiseIgnoringPanicHandler"],
    env: mergeWindowEnvs([
      bunEnv,
      {
        BUN_CRASH_REPORT_URL: server.url.toString(),
        BUN_ENABLE_CRASH_REPORTING: "1",
      },
    ]),
  });

  await proc.exited;

  /// Wait two seconds for a slow http request, or continue immediately once the request is heard.
  await Promise.race([resolve_handler.promise, Bun.sleep(2000)]);

  expect(proc.exited).resolves.not.toBe(0);
  expect(sent).toBe(false);
});

describe("automatic crash reporter", () => {
  for (const approach of ["panic", "segfault", "outOfMemory"]) {
    test(`${approach} should report`, async () => {
      let sent = false;
      const resolve_handler = Promise.withResolvers();

      // Self host the crash report backend.
      using server = Bun.serve({
        port: 0,
        fetch(request, server) {
          expect(request.url).toEndWith("/ack");
          sent = true;
          resolve_handler.resolve();
          return new Response("OK");
        },
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), path.join(import.meta.dir, "fixture-crash.js"), approach],
        env: mergeWindowEnvs([
          bunEnv,
          {
            BUN_CRASH_REPORT_URL: server.url.toString(),
            BUN_ENABLE_CRASH_REPORTING: "1",
            GITHUB_ACTIONS: undefined,
            CI: undefined,
          },
        ]),
        stdio: ["ignore", "pipe", "pipe"],
      });
      const exitCode = await proc.exited;
      const stderr = await proc.stderr.text();
      console.log(stderr);

      await resolve_handler.promise;

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain(server.url.toString());
      if (approach !== "outOfMemory") {
        expect(stderr).toContain("oh no: Bun has crashed. This indicates a bug in Bun, not your code");
      } else {
        expect(stderr.toLowerCase()).toContain("out of memory");
        expect(stderr.toLowerCase()).not.toContain("panic");
      }
      expect(sent).toBe(true);
    });
  }
});

// ASAN builds don't install Bun's segfault handler.
describe.skipIf(isASAN)("ucontext-aware fault handler", () => {
  async function crash(approach: "panic" | "segfault") {
    let reportedPath: string | undefined;
    const reported = Promise.withResolvers<void>();

    using server = Bun.serve({
      port: 0,
      fetch(request) {
        reportedPath = new URL(request.url).pathname;
        reported.resolve();
        return new Response("OK");
      },
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "fixture-crash.js"), approach],
      env: mergeWindowEnvs([
        bunEnv,
        {
          BUN_CRASH_REPORT_URL: server.url.toString(),
          BUN_ENABLE_CRASH_REPORTING: "1",
          GITHUB_ACTIONS: undefined,
          CI: undefined,
        },
      ]),
      stdio: ["ignore", "pipe", "pipe"],
    });

    const [, stderr] = await Promise.all([proc.exited, proc.stderr.text()]);
    await reported.promise;

    // Trace URL path: /<bun-version>/<platform><cmd><version_char><7-char-sha><body>/ack
    const m = reportedPath!.match(
      /^\/[\w.+-]+\/[a-zA-Z][a-zA-Z_](?<ver>[0-9])(?:[0-9a-f]{7}|unknown)(?<body>.*)\/ack$/,
    );
    expect(stderr).toContain(reportedPath!.replace(/\/ack$/, ""));
    expect(m, `unexpected trace URL: ${reportedPath}`).not.toBeNull();
    return { ver: m!.groups!.ver, body: m!.groups!.body };
  }

  test("trace string uses v3/v4 format with register block", async () => {
    const segv = await crash("segfault");
    // Older builds emit '1'/'2' here; '3'/'4' means the encoder appends the
    // GP register set after the fault address.
    expect(segv.ver).toMatch(/^[34]$/);
  });

  test("segfault trace string is longer than panic (encodes registers)", async () => {
    const [segv, panic] = await Promise.all([crash("segfault"), crash("panic")]);
    // Both share the same frames+features prefix length to within a few bytes;
    // the segfault body additionally carries 16-32 GP registers as two VLQs
    // each, which is at least ~80 chars even when most regs are zero.
    expect(segv.body.length - panic.body.length).toBeGreaterThan(50);
  });
});
