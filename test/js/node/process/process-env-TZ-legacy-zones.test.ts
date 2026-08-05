// JSC's intlResolveTimeZoneID drops non-'/' zone names, so TZ=EST5EDT (and the
// seven others below) silently fell back to UTC. Bun maps them to their tzdata
// `backward` Link targets before calling into JSC, matching Node.

import { setTimeZone } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// July 14 2018 12:34:56 UTC: northern-hemisphere summer, so the DST-bearing
// zones are on daylight offsets. Offsets are what `new Date().getTimezoneOffset()`
// returns (UTC - local, in minutes).
const summer = "2018-07-14T12:34:56Z";
const zones = [
  { tz: "EST5EDT", canonical: "America/New_York", offset: 240, display: /Eastern Daylight Time/ },
  { tz: "CST6CDT", canonical: "America/Chicago", offset: 300, display: /Central Daylight Time/ },
  { tz: "MST7MDT", canonical: "America/Denver", offset: 360, display: /Mountain Daylight Time/ },
  { tz: "PST8PDT", canonical: "America/Los_Angeles", offset: 420, display: /Pacific Daylight Time/ },
  { tz: "CET", canonical: "Europe/Brussels", offset: -120, display: /Central European Summer Time/ },
  { tz: "MET", canonical: "Europe/Brussels", offset: -120, display: /Central European Summer Time/ },
  { tz: "EET", canonical: "Europe/Athens", offset: -180, display: /Eastern European Summer Time/ },
  { tz: "WET", canonical: "Europe/Lisbon", offset: -60, display: /Western European Summer Time/ },
] as const;

const probe = `
  const d = new Date(${JSON.stringify(summer)});
  process.stdout.write(JSON.stringify({
    tz: process.env.TZ,
    offset: d.getTimezoneOffset(),
    string: d.toString(),
    resolved: new Intl.DateTimeFormat().resolvedOptions().timeZone,
  }));
`;

describe("TZ=<legacy zone> at process start", () => {
  test.concurrent.each(zones)("TZ=$tz resolves to $canonical", async ({ tz, canonical, offset, display }) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", probe],
      env: { ...bunEnv, TZ: tz },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const out = JSON.parse(stdout);
    expect(out.tz).toBe(tz);
    expect(out.offset).toBe(offset);
    expect(out.string).toMatch(display);
    expect(out.resolved).toBe(canonical);
    expect(exitCode).toBe(0);
  });
});

describe("process.env.TZ = <legacy zone> at runtime", () => {
  test.concurrent.each(zones)(
    "process.env.TZ = $tz resolves to $canonical",
    async ({ tz, canonical, offset, display }) => {
      const script = `
      process.env.TZ = ${JSON.stringify(tz)};
      const d = new Date(${JSON.stringify(summer)});
      process.stdout.write(JSON.stringify({
        offset: d.getTimezoneOffset(),
        string: d.toString(),
        resolved: new Intl.DateTimeFormat().resolvedOptions().timeZone,
      }));
    `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: { ...bunEnv, TZ: "UTC" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const out = JSON.parse(stdout);
      expect(out.offset).toBe(offset);
      expect(out.string).toMatch(display);
      expect(out.resolved).toBe(canonical);
      expect(exitCode).toBe(0);
    },
  );
});

describe("bun:jsc setTimeZone(<legacy zone>)", () => {
  test.each(zones)("setTimeZone($tz) resolves to $canonical", ({ tz, canonical, offset }) => {
    const before = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      const ret = setTimeZone(tz);
      expect(ret).toBe(canonical);
      expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(canonical);
      expect(new Date(summer).getTimezoneOffset()).toBe(offset);
    } finally {
      setTimeZone(before);
    }
  });
});

test.concurrent("unrelated IANA zones still work", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", probe],
    env: { ...bunEnv, TZ: "America/New_York" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const out = JSON.parse(stdout);
  expect(out.offset).toBe(240);
  expect(out.resolved).toBe("America/New_York");
  expect(exitCode).toBe(0);
});

test.concurrent("unknown TZ values remain unknown", async () => {
  // ICU rejects this; the override stays unset and the host default applies.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", probe],
    env: { ...bunEnv, TZ: "Not/A_Zone" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const out = JSON.parse(stdout);
  expect(Number.isInteger(out.offset)).toBe(true);
  expect(out.resolved).not.toBe("Not/A_Zone");
  expect(exitCode).toBe(0);
});
