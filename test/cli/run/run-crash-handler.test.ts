import { crash_handler } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, mergeWindowEnvs } from "harness";
import os from "os";
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

// Sourcemap-style base64 VLQ decoder.
function decodeVLQ(str: string, start: number): { value: number; next: number } {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = 0;
  let shift = 0;
  let i = start;
  while (true) {
    const digit = alphabet.indexOf(str[i++]);
    if (digit === -1) throw new Error(`invalid VLQ char '${str[i - 1]}' at ${i - 1}`);
    result |= (digit & 0b11111) << shift;
    if ((digit & 0b100000) === 0) break;
    shift += 5;
  }
  const negative = (result & 1) === 1;
  result >>>= 1;
  return { value: negative ? -result : result, next: i };
}

test("trace string v3 encodes OS version, env flags, CPU flags, and RAM", async () => {
  const received = Promise.withResolvers<string>();
  using server = Bun.serve({
    port: 0,
    fetch(request) {
      received.resolve(new URL(request.url).pathname);
      return new Response("OK");
    },
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "fixture-crash.js"), "panic"],
    env: mergeWindowEnvs([
      bunEnv,
      {
        BUN_CRASH_REPORT_URL: server.url.toString(),
        BUN_ENABLE_CRASH_REPORTING: "1",
        GITHUB_ACTIONS: undefined,
        CI: undefined,
      },
    ]),
    stdio: ["ignore", "ignore", "pipe"],
  });
  await proc.exited;
  const pathname = await received.promise;

  // /{semver}/{P}{C}{V}{sha7}{os0}{os1}{os2}{env}{cpu}{ram}{features...}{addrs...}{reason}
  const secondSlash = pathname.indexOf("/", 1);
  const body = pathname.slice(secondSlash + 1);

  expect(body[2]).toBe("3"); // format version char

  // 6 new VLQs immediately after the 7-char sha
  let cursor = 3 + 7;
  const vlqs: number[] = [];
  for (let n = 0; n < 6; n++) {
    const { value, next } = decodeVLQ(body, cursor);
    vlqs.push(value);
    cursor = next;
  }
  const [osMajor, osMinor, osPatch, env, cpu, ramMB] = vlqs;

  // OS version should match what Node's os module reports.
  if (process.platform === "darwin") {
    // kern.osproductversion (e.g. "26.4")
    const proc = Bun.spawnSync({ cmd: ["sysctl", "-n", "kern.osproductversion"] });
    const [maj, min = 0, pat = 0] = proc.stdout.toString().trim().split(".").map(Number);
    expect(osMajor).toBe(maj);
    expect(osMinor).toBe(min);
    expect(osPatch).toBe(pat);
  } else if (process.platform === "linux") {
    const [maj, min, pat] = os.release().split("-")[0].split(".").map(Number);
    expect(osMajor).toBe(maj);
    expect(osMinor).toBe(min);
    expect(osPatch).toBe(pat);
  } else if (process.platform === "win32") {
    expect(osMajor).toBeGreaterThanOrEqual(10);
    expect(osPatch).toBeGreaterThan(0); // build number
  }

  // env flags: bit0=wsl, bit1=musl, bit2=emulated_x64, bit3=canary
  // Only 4 bits used; upper 4 reserved and must be zero.
  expect(env).toBeGreaterThanOrEqual(0);
  expect(env).toBeLessThan(16);

  // cpu flags: nonzero on any real hardware
  expect(cpu).toBeGreaterThan(0);

  // RAM within 10% of os.totalmem()
  const expectedMB = Math.round(os.totalmem() / (1024 * 1024));
  expect(ramMB).toBeGreaterThan(expectedMB * 0.9);
  expect(ramMB).toBeLessThan(expectedMB * 1.1);
});
