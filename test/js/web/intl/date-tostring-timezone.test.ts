// Date.prototype.toString() / toTimeString() print a parenthesized zone name
// after the numeric offset. When ICU has no metazone display name for the zone
// it falls back to a "GMT+HH:MM" literal. That fallback must be computed from
// the offset AT THE INSTANT, not from the zone's present-day raw offset, or
// the string contradicts itself: "GMT+0200 (GMT+03:00)".

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

type Row = { numeric: string; name: string; nameOffset: string | null; s: string };

function parseRow(s: string): Row {
  const m = s.match(/GMT([+-]\d{4})(?: \((.*)\))?$/);
  if (!m) throw new Error("no GMT match: " + s);
  const numeric = m[1];
  const name = m[2] ?? "";
  // If the parenthesized name is itself a GMT-offset literal, normalize it to
  // the +HHMM form so it can be compared with the numeric offset.
  const nm = name.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  let nameOffset: string | null = null;
  if (nm) nameOffset = nm[1] + nm[2].padStart(2, "0") + (nm[3] ?? "00");
  return { numeric, name, nameOffset, s };
}

async function run(tz: string, instants: string[]): Promise<Row[]> {
  const script = instants.map(iso => `console.log(new Date(${JSON.stringify(iso)}).toString());`).join("\n");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, TZ: tz },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const rows = stdout.trim().split("\n").map(parseRow);
  expect(exitCode).toBe(0);
  return rows;
}

describe("Date.prototype.toString() parenthesized zone name", () => {
  // Zones whose base UTC offset has changed: the GMT-literal fallback must use
  // the instant's offset. Before the fix these produced e.g. (GMT+03:00) for a
  // +0200 instant.
  const contradicting: [string, [string, string][]][] = [
    // Istanbul was UTC+2/+3 (EET/EEST) until Sep 2016, then permanent UTC+3.
    ["Europe/Istanbul", [
      ["2010-01-15T12:00:00Z", "+0200"],
      ["2010-07-15T12:00:00Z", "+0300"],
      ["2020-01-15T12:00:00Z", "+0300"],
    ]],
    // Kolkata observed +0630 during WWII; current offset is +0530.
    ["Asia/Kolkata", [
      ["1945-01-15T12:00:00Z", "+0630"],
      ["2020-01-15T12:00:00Z", "+0530"],
    ]],
    // Bougainville switched from +1000 to +1100 in Dec 2014.
    ["Pacific/Bougainville", [
      ["2010-01-15T12:00:00Z", "+1000"],
      ["2020-01-15T12:00:00Z", "+1100"],
    ]],
    // Famagusta split from Nicosia (UTC+2) to UTC+3 in 2016-17, then back.
    ["Asia/Famagusta", [
      ["2017-01-15T12:00:00Z", "+0300"],
    ]],
    // Astrakhan was UTC+3 until Mar 2016, then UTC+4.
    ["Europe/Astrakhan", [
      ["2010-01-15T12:00:00Z", "+0300"],
      ["2020-01-15T12:00:00Z", "+0400"],
    ]],
  ];

  for (const [tz, cases] of contradicting) {
    test.concurrent(`${tz}: GMT-literal fallback matches numeric offset`, async () => {
      const rows = await run(tz, cases.map(c => c[0]));
      for (let i = 0; i < cases.length; i++) {
        const expected = cases[i][1];
        const r = rows[i];
        expect(r.numeric, r.s).toBe(expected);
        // Whether ICU emits a metazone name or a GMT literal depends on ICU/CLDR
        // data. Either is fine; the invariant is that a GMT literal never
        // contradicts the numeric offset.
        if (r.nameOffset !== null) {
          expect(r.nameOffset, r.s).toBe(expected);
        }
      }
    });
  }

  // Sanity: zones with stable metazone names keep printing them and track DST.
  test.concurrent("America/Los_Angeles: still prints Pacific metazone names", async () => {
    const rows = await run("America/Los_Angeles", ["2020-01-15T12:00:00Z", "2020-07-15T12:00:00Z"]);
    expect(rows.map(r => ({ numeric: r.numeric, name: r.name }))).toEqual([
      { numeric: "-0800", name: "Pacific Standard Time" },
      { numeric: "-0700", name: "Pacific Daylight Time" },
    ]);
  });

  test.concurrent("Asia/Tokyo: still prints Japan Standard Time", async () => {
    const rows = await run("Asia/Tokyo", ["2020-01-15T12:00:00Z"]);
    expect(rows.map(r => ({ numeric: r.numeric, name: r.name }))).toEqual([
      { numeric: "+0900", name: "Japan Standard Time" },
    ]);
  });

  // toTimeString() shares the same path.
  test.concurrent("toTimeString() is consistent too", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `console.log(new Date("2010-01-15T12:00:00Z").toTimeString())`],
      env: { ...bunEnv, TZ: "Europe/Istanbul" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const r = parseRow(stdout.trim());
    expect(r.numeric).toBe("+0200");
    if (r.nameOffset !== null) expect(r.nameOffset).toBe("+0200");
    expect(exitCode).toBe(0);
  });
});
