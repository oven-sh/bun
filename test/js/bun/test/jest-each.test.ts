import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

const NUMBERS = [
  [1, 1, 2],
  [1, 2, 3],
  [2, 1, 3],
];

describe("jest-each", () => {
  it("check types", () => {
    expect(it.each).toBeTypeOf("function");
    expect(it.each([])).toBeTypeOf("function");
  });
  it.each(NUMBERS)("%i + %i = %i", (a, b, e) => {
    expect(a + b).toBe(e);
  });
  it.each(NUMBERS)("with callback: %f + %d = %f", (a, b, e, done) => {
    expect(a + b).toBe(e);
    expect(done).toBeDefined();
    // We cast here because we cannot type done when typing args as ...T
    (done as unknown as (err?: unknown) => void)();
  });
  it.each([
    ["a", "b", "ab"],
    ["c", "d", "cd"],
    ["e", "f", "ef"],
  ])("%s + %s = %s", (a, b, res) => {
    expect(typeof a).toBe("string");
    expect(typeof b).toBe("string");
    expect(typeof res).toBe("string");
    expect(a.concat(b)).toBe(res);
  });
  it.each([
    { a: 1, b: 1, e: 2 },
    { a: 1, b: 2, e: 3 },
    { a: 2, b: 13, e: 15 },
    { a: 2, b: 13, e: 15 },
    { a: 2, b: 123, e: 125 },
    { a: 15, b: 13, e: 28 },
  ])("add two numbers with object: %o", ({ a, b, e }, cb) => {
    expect(a + b).toBe(e);
    cb();
  });

  it.each([undefined, null, NaN, Infinity])("stringify %#: %j", (arg, cb) => {
    cb();
  });
});

describe.each(["some", "cool", "strings"])("works with describe: %s", s => {
  it(`has access to params : ${s}`, done => {
    expect(s).toBeTypeOf("string");
    done();
  });
});

describe("does not return zero", () => {
  expect(it.each([1, 2])("wat", () => {})).toBeUndefined();
});

describe("%j title memory", () => {
  // The %j/%o title formatter used to leak one WTFStringImpl copy of the
  // stringified JSON per registered test (jest.rs format_label).
  it("does not retain a second copy of each stringified title", async () => {
    const fixture = import.meta.dir + "/jest-each-json-title-leak-fixture.ts";

    async function rssWithRows(rows: number): Promise<number> {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", fixture],
        env: {
          ...bunEnv,
          LEAK_FIXTURE_ROWS: String(rows),
          // ASAN's quarantine keeps freed allocations in RSS; without this
          // the fixed build measures the same as the leaky one. The override
          // comes last because ASAN's option parsing is last-wins.
          ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0", "thread_local_quarantine_size_kb=0"]
            .filter(Boolean)
            .join(":"),
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const match = (out + err).match(/RSS_BYTES:(\d+)/);
      if (!match) {
        // Bounded tails: err is ~70MB of 512KB titles on a healthy run.
        throw new Error(
          `Expected RSS_BYTES marker. exit code: ${code}\nstdout tail:\n${out.slice(-2000)}\nstderr tail:\n${err.slice(-2000)}`,
        );
      }
      expect(code).toBe(0);
      return Number(match![1]);
    }

    // 128 extra rows x ~512KB stringified title: the titles themselves
    // retain ~64MB in every build. The unfixed build leaked a second copy
    // per title (~132MB delta measured on both release and debug-asan);
    // the fixed build stays at ~66MB.
    const small = await rssWithRows(8);
    const large = await rssWithRows(136);
    expect(large - small).toBeLessThan(100 * 1024 * 1024);
  }, 120_000);
});
