// https://github.com/oven-sh/bun/issues/8060
//
// JSC resolves the default time zone by name through intlResolveTimeZoneID; a
// TZ value it cannot name collapses to UTC. Bun now normalizes POSIX TZ forms
// (leading ':', absolute tzfile paths, "std offset" specs) to an IANA name
// before handing them to JSC so Date offsets match Node.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";
import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";

const script =
  "process.stdout.write(String(new Date().getTimezoneOffset()) + ' ' + Intl.DateTimeFormat().resolvedOptions().timeZone)";

async function offset(tz: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, TZ: tz },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  const [off, intl] = stdout.split(" ");
  return { offset: Number(off), intl };
}

describe.concurrent("process.env.TZ POSIX std+offset form", () => {
  test.each([
    // POSIX offset sign is hours *west* of UTC, so MSK-3 is UTC+3.
    ["MSK-3", -180, "Etc/GMT-3"],
    ["UTC+5", 300, "Etc/GMT+5"],
    ["ABC5", 300, "Etc/GMT+5"],
    ["ABC-5", -300, "Etc/GMT-5"],
    ["XXX-14", -840, "Etc/GMT-14"],
    ["XXX+12", 720, "Etc/GMT+12"],
    ["ABC0", 0, "UTC"],
  ] as const)("TZ=%s", async (tz, expectedOffset, expectedIntl) => {
    const { offset: off, intl } = await offset(tz);
    expect(off).toBe(expectedOffset);
    expect(intl).toBe(expectedIntl);
  });

  test("runtime assignment: process.env.TZ = 'MSK-3'", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "process.env.TZ = 'MSK-3'; process.stdout.write(String(new Date().getTimezoneOffset()))"],
      env: { ...bunEnv, TZ: "Etc/UTC" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("-180");
    expect(exitCode).toBe(0);
  });

  // Forms the normalizer must NOT parse as an offset. The fall-through zone is
  // host-dependent (registry on Windows, /etc/localtime for some of these on
  // POSIX), so assert the override is not an Etc/GMT* zone rather than a fixed
  // offset.
  test.each(["XXX+13", "IST-5:30", "FOO4BAR", "XX-3", "ABC-05:00"])("TZ=%s is not parsed as an offset", async tz => {
    const { intl } = await offset(tz);
    expect(intl).not.toMatch(/^Etc\/GMT[+-]/);
  });
});

describe.concurrent("process.env.TZ leading colon", () => {
  test("':America/New_York' strips the colon", async () => {
    const { intl } = await offset(":America/New_York");
    expect(intl).toBe("America/New_York");
  });
});

describe.concurrent.skipIf(!isPosix)("process.env.TZ absolute tzfile path", () => {
  const target = "Australia/Sydney";
  const zoneinfo = ["/usr/share/zoneinfo", "/usr/lib/zoneinfo", "/etc/zoneinfo"]
    .map(dir => join(dir, target))
    .find(p => existsSync(p));

  test.skipIf(!zoneinfo)("':/etc/localtime' style symlink resolves to the zone it points at", async () => {
    using dir = tempDir("tz-localtime", {});
    const link = join(String(dir), "localtime");
    symlinkSync(zoneinfo!, link);
    // Resolve through the symlink just like a container-mounted /etc/localtime.
    const { intl } = await offset(":" + link);
    expect(intl).toBe(target);
  });

  test.skipIf(!zoneinfo)("'/usr/share/zoneinfo/...' prefix is stripped", async () => {
    const { intl } = await offset(zoneinfo!);
    expect(intl).toBe(target);
  });

  test.skipIf(!zoneinfo)("':/usr/share/zoneinfo/...'", async () => {
    const { intl } = await offset(":" + zoneinfo!);
    expect(intl).toBe(target);
  });
});

describe.concurrent("process.env.TZ IANA name unchanged", () => {
  test.each([
    ["America/New_York", "America/New_York"],
    ["Etc/GMT-3", "Etc/GMT-3"],
    ["UTC", "UTC"],
  ] as const)("TZ=%s", async (tz, expectedIntl) => {
    const { intl } = await offset(tz);
    expect(intl).toBe(expectedIntl);
  });
});

test("runtime assignment of an unrecognized TZ clears a prior override", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const host = new Date().getTimezoneOffset();
       process.env.TZ = 'Asia/Tokyo';
       const a = new Date().getTimezoneOffset();
       process.env.TZ = 'not a real zone';
       const b = new Date().getTimezoneOffset();
       process.stdout.write(host + ' ' + a + ' ' + b);`,
    ],
    env: { ...bunEnv, TZ: "Etc/UTC" },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const [host, a, b] = stdout.split(" ").map(Number);
  expect(a).toBe(-540);
  expect(b).not.toBe(a);
  if (isPosix) expect(b).toBe(host);
  expect(exitCode).toBe(0);
});
