import { describe, expect, test } from "bun:test";

describe("Intl.DateTimeFormat timeZone option", () => {
  // https://github.com/oven-sh/bun/issues/30618
  //
  // `CET`, `CST6CDT`, `EET`, `EST5EDT`, `MET`, `MST7MDT`, `PST8PDT`, `WET` are
  // first-class Zones in the IANA `etcetera` file (not backward links). ICU
  // reports them as canonical primaries, so Intl.DateTimeFormat must accept
  // them — WebKit's `isValidTimeZoneNameFromICUTimeZone` used to drop every
  // non-`/` zone except UTC/GMT, which broke these on Linux/Windows (macOS was
  // unaffected because it links the system libicucore).
  //
  // Per test262 `intl402/DateTimeFormat/timezone-case-insensitive.js`, each
  // of these identifiers is expected to round-trip to itself through
  // resolvedOptions().timeZone.
  const legacyPrimaryZones = ["CET", "CST6CDT", "EET", "EST5EDT", "MET", "MST7MDT", "PST8PDT", "WET"] as const;

  describe.each(legacyPrimaryZones)("%s", zone => {
    test("is accepted as a valid IANA primary zone", () => {
      const fmt = new Intl.DateTimeFormat("en-US", { timeZone: zone });
      expect(fmt.resolvedOptions().timeZone).toBe(zone);
    });
  });

  test("legacy primary zones are case-insensitive and normalize to the canonical casing", () => {
    expect(new Intl.DateTimeFormat("en-US", { timeZone: "cet" }).resolvedOptions().timeZone).toBe("CET");
    expect(new Intl.DateTimeFormat("en-US", { timeZone: "Cst6Cdt" }).resolvedOptions().timeZone).toBe("CST6CDT");
    expect(new Intl.DateTimeFormat("en-US", { timeZone: "est5edt" }).resolvedOptions().timeZone).toBe("EST5EDT");
    expect(new Intl.DateTimeFormat("en-US", { timeZone: "pst8pdt" }).resolvedOptions().timeZone).toBe("PST8PDT");
  });

  test("Intl.supportedValuesOf('timeZone') lists the legacy primary zones", () => {
    const supported = new Set(Intl.supportedValuesOf("timeZone"));
    for (const zone of legacyPrimaryZones) {
      expect(supported.has(zone)).toBe(true);
    }
  });

  test("legacy primary zones apply the expected offset + DST", () => {
    // 2024-06-15T12:00Z is in summer, so CET-observing zones are at +02:00,
    // EET-observing zones at +03:00, WET-observing zones at +01:00, and the
    // North American zones are on their respective DSTs.
    const d = new Date("2024-06-15T12:00:00Z");
    const hourOptions = {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    } as const;
    const formatIn = (tz: string) => new Intl.DateTimeFormat("en-US", { ...hourOptions, timeZone: tz }).format(d);
    expect(formatIn("CET")).toBe("14:00");
    expect(formatIn("MET")).toBe("14:00");
    expect(formatIn("EET")).toBe("15:00");
    expect(formatIn("WET")).toBe("13:00");
    expect(formatIn("CST6CDT")).toBe("07:00");
    expect(formatIn("EST5EDT")).toBe("08:00");
    expect(formatIn("MST7MDT")).toBe("06:00");
    expect(formatIn("PST8PDT")).toBe("05:00");
  });

  test("unknown zones still throw RangeError", () => {
    expect(() => new Intl.DateTimeFormat("en-US", { timeZone: "Not/A_Zone" })).toThrow(RangeError);
    expect(() => new Intl.DateTimeFormat("en-US", { timeZone: "BogusZone" })).toThrow(RangeError);
  });

  test("standard IANA zones continue to work", () => {
    const fmt = (tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone;
    expect(fmt("UTC")).toBe("UTC");
    expect(fmt("GMT")).toBe("GMT");
    expect(fmt("America/New_York")).toBe("America/New_York");
    expect(fmt("Europe/London")).toBe("Europe/London");
    expect(fmt("Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(fmt("Etc/GMT+5")).toBe("Etc/GMT+5");
  });
});
