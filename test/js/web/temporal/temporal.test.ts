import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";
import path from "node:path";

// https://github.com/oven-sh/bun/issues/15853
// The default-on/opt-out subprocess tests live in
// test/js/bun/jsc/temporal-global.test.ts next to the other JSC option tests.
describe.concurrent("Temporal global", () => {
  test("is installed with the spec property attributes", () => {
    expect(Object.getOwnPropertyDescriptor(globalThis, "Temporal")).toMatchObject({
      writable: true,
      enumerable: false,
      configurable: true,
    });
  });

  test("exposes all nine namespaces", () => {
    expect(Object.getOwnPropertyNames(Temporal).sort()).toEqual([
      "Duration",
      "Instant",
      "Now",
      "PlainDate",
      "PlainDateTime",
      "PlainMonthDay",
      "PlainTime",
      "PlainYearMonth",
      "ZonedDateTime",
    ]);
    expect(Temporal[Symbol.toStringTag]).toBe("Temporal");
  });
});

describe("Temporal core operations", () => {
  test("Temporal.Now", () => {
    expect(Temporal.Now.instant()).toBeInstanceOf(Temporal.Instant);
    expect(Temporal.Now.plainDateISO()).toBeInstanceOf(Temporal.PlainDate);
    expect(Temporal.Now.plainDateTimeISO()).toBeInstanceOf(Temporal.PlainDateTime);
    expect(Temporal.Now.plainTimeISO()).toBeInstanceOf(Temporal.PlainTime);
    expect(Temporal.Now.zonedDateTimeISO()).toBeInstanceOf(Temporal.ZonedDateTime);
    expect(typeof Temporal.Now.timeZoneId()).toBe("string");
  });

  test("parsing, arithmetic, and formatting round-trip", () => {
    const d = Temporal.PlainDate.from("2024-06-15");
    expect(d.add({ months: 1, days: 20 }).toString()).toBe("2024-08-04");
    expect(d.since("2023-01-01", { largestUnit: "month" }).toString()).toBe("P17M14D");

    const i = Temporal.Instant.from("2024-06-15T12:34:56.789Z");
    expect(i.epochMilliseconds).toBe(1718454896789);
    expect(i.round({ smallestUnit: "minute" }).toString()).toBe("2024-06-15T12:35:00Z");

    const z = Temporal.ZonedDateTime.from("2024-06-15T12:34:56-04:00[America/New_York]");
    expect(z.toString()).toBe("2024-06-15T12:34:56-04:00[America/New_York]");
    expect(z.withTimeZone("Asia/Tokyo").toString()).toBe("2024-06-16T01:34:56+09:00[Asia/Tokyo]");

    expect(Temporal.Duration.from({ hours: 36, minutes: 30 }).round({ largestUnit: "day" }).toString()).toBe(
      "P1DT12H30M",
    );
  });

  test("DST disambiguation", () => {
    // 2024-03-10 02:30 does not exist in America/New_York (spring-forward gap).
    const gap = Temporal.PlainDateTime.from("2024-03-10T02:30:00");
    expect(gap.toZonedDateTime("America/New_York", { disambiguation: "earlier" }).toString()).toBe(
      "2024-03-10T01:30:00-05:00[America/New_York]",
    );
    expect(gap.toZonedDateTime("America/New_York", { disambiguation: "later" }).toString()).toBe(
      "2024-03-10T03:30:00-04:00[America/New_York]",
    );
    expect(() => gap.toZonedDateTime("America/New_York", { disambiguation: "reject" })).toThrow(RangeError);
  });

  test("Date.prototype.toTemporalInstant", () => {
    const date = new Date("2024-06-15T12:34:56.789Z");
    const instant = date.toTemporalInstant();
    expect(instant).toBeInstanceOf(Temporal.Instant);
    expect(instant.epochMilliseconds).toBe(date.getTime());
  });

  test("Intl.DateTimeFormat formats Temporal objects", () => {
    const d = Temporal.PlainDate.from("2024-06-15");
    expect(new Intl.DateTimeFormat("en-US").format(d)).toBe("6/15/2024");
    expect(d.toLocaleString("en-US")).toBe("6/15/2024");
  });

  test("structuredClone rejects Temporal objects", () => {
    expect(() => structuredClone(Temporal.PlainDate.from("2024-06-15"))).toThrow(DOMException);
    expect(() => structuredClone(Temporal.Instant.from("2024-06-15T00:00Z"))).toThrow(DOMException);
  });
});

// Non-ISO calendar arithmetic opens ICU UCalendar templates that
// TemporalCore::withCalendar caches for the process lifetime. The cache entry
// owning them lives in bmalloc memory LeakSanitizer cannot scan, so without
// the matching test/leaksan.supp entry LSan nondeterministically reports them
// as direct leaks at exit (whether a stale stack pointer still reaches the
// UCalendar decides each run). Pins the suppression: a calendar-heavy
// workload must exit leak-clean under the repo suppression file.
test.skipIf(!isASAN)(
  "non-ISO calendar arithmetic is leak-clean under LeakSanitizer",
  async () => {
    // The workload runs in a timer callback: a top-level (module) stack puts
    // JSC::JSModuleLoader::evaluateNonVirtual in every allocation stack, which
    // the suppression file already covers wholesale. bun:test callbacks run
    // via JSValue::call with no module-loader frame (how CI hit this); a timer
    // callback has the same shape.
    const code = `
      setTimeout(() => {
        const calendars = ["hebrew", "chinese", "indian", "persian", "coptic", "buddhist", "japanese", "roc"];
        for (const calendar of calendars) {
          const date = Temporal.PlainDate.from("2024-06-15[u-ca=" + calendar + "]");
          if (typeof (date.year + date.month + date.day) !== "number" || !date.monthCode) throw new Error(calendar);
          Temporal.PlainYearMonth.from("2024-06-15[u-ca=" + calendar + "]").toString();
          Temporal.PlainMonthDay.from("2024-06-15[u-ca=" + calendar + "]").toString();
        }
        // Scrub the stack so no stale pointer to an ICU object survives for
        // LSan's conservative scan; staying clean is on the suppression alone.
        (function burn(n) { return n > 0 ? burn(n - 1) : JSON.parse(JSON.stringify({ n })); })(2000);
        console.log("OK");
      }, 0);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", code],
      env: {
        ...bunEnv,
        // An order of magnitude slower on debug builds, and unrelated to leaks.
        BUN_JSC_validateExceptionChecks: undefined,
        BUN_JSC_dumpSimulatedThrows: undefined,
        BUN_DESTRUCT_VM_ON_EXIT: "1",
        ASAN_OPTIONS: "allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1",
        LSAN_OPTIONS: `malloc_context_size=30:print_suppressions=0:suppressions=${path.join(import.meta.dir, "..", "..", "..", "leaksan.supp")}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // LSan writes its leak report to stderr and SIGABRTs; stdout holds the
    // workload's OK line either way, so assert exitCode/signal explicitly.
    expect({ stdout, stderr, signal: proc.signalCode, exitCode }).toEqual({
      stdout: "OK\n",
      stderr: expect.not.stringContaining("LeakSanitizer"),
      signal: null,
      exitCode: 0,
    });
  },
  20_000,
);
