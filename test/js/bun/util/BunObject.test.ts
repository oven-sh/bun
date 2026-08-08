import { env } from "bun";
import { hasNonReifiedStatic } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
test("hasNonReifiedStatic", () => {
  expect(hasNonReifiedStatic(Bun), "do not eagerly initialize the Bun object. This will make Bun much slower.").toBe(
    true,
  );
  expect(env.a).toBeUndefined();
  expect(hasNonReifiedStatic(Bun), "do not eagerly initialize the Bun object. This will make Bun much slower.").toBe(
    true,
  );
  const a = { ...Bun };
  globalThis.a = a;
  expect(hasNonReifiedStatic(Bun)).toBe(false);
});

test("require('bun')", () => {
  const str = eval("'bun'");
  expect(require(str)).toBe(Bun);
});

test("await import('bun')", async () => {
  const str = eval("'bun'");
  const BunESM = await import(str);

  // console.log it so that we iterate through all the fields and crash if it's
  // in an unexpected state.
  console.log(BunESM);

  for (let property in Bun) {
    expect(BunESM).toHaveProperty(property);
    expect(BunESM[property]).toBe(Bun[property]);
  }
  expect(BunESM.default).toBe(Bun);
});

// https://github.com/oven-sh/bun/issues/19650
describe.concurrent("a lazy Bun.* getter that throws reifies the property as undefined", () => {
  test.each(["Error = 1", "Symbol = Bun"])(
    "Bun.$ / Bun.sql / Bun.SQL / Bun.postgres after `%s` (builtin module fails to evaluate)",
    async tamper => {
      const names = ["$", "sql", "SQL", "postgres"];
      const reads = names
        .map(
          n =>
            `try { Bun[${JSON.stringify(n)}]; } catch {} console.log(${JSON.stringify(n)}, typeof Bun[${JSON.stringify(n)}]);`,
        )
        .join("\n");
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", `${tamper};\n${reads}`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, signalCode: proc.signalCode, exitCode, reported: stderr.includes("TypeError") }).toEqual({
        stdout: "$ undefined\nsql undefined\nSQL undefined\npostgres undefined\n",
        signalCode: null,
        exitCode: 1,
        reported: true,
      });
    },
  );

  test("Bun.redis (Rust getter throws)", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `try { Bun.redis; } catch {} console.log(typeof Bun.redis);`],
      env: { ...bunEnv, REDIS_URL: "http://not-redis" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, signalCode: proc.signalCode, exitCode, reported: stderr.includes("url protocol") }).toEqual({
      stdout: "undefined\n",
      signalCode: null,
      exitCode: 1,
      reported: true,
    });
  });
});
