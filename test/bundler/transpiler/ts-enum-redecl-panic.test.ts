import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// When an `enum` redeclares a name whose merge result is `Forbidden` (e.g. it
// was already declared as a function/class/let/const), `declare_symbol`
// returns the existing symbol's `Ref`. A second colliding `enum` therefore
// returns the same `Ref` again, so the enum parser's insert into
// `ref_to_ts_namespace_member` sees the key it inserted for the first enum.
// That insert used to debug_assert the key was fresh, which turned a
// user-facing "already declared" parse error into a panic in builds with
// debug assertions enabled.
describe("enum redeclared after a non-mergeable symbol reports an error instead of asserting", () => {
  const cases: [label: string, source: string][] = [
    ["function then enum x2", "function X() {}\nenum X {}\nenum X {}\n"],
    ["class then enum x2", "class X {}\nenum X {}\nenum X {}\n"],
    ["let then enum x2", "let X = 1;\nenum X {}\nenum X {}\n"],
    ["const then enum x2", "const X = 1;\nenum X {}\nenum X {}\n"],
    ["function then enum x3", "function X() {}\nenum X {}\nenum X {}\nenum X {}\n"],
    [
      "fuzz repro (CRLF)",
      "function Reflect() {} // only)\r\nenum Reflect {} // collision\r\nenum Reflect {} // collision\r\n",
    ],
  ];

  test.concurrent.each(cases)("%s", async (_label, source) => {
    const script = `
      let threw;
      try {
        new Bun.Transpiler({ loader: "tsx", target: "node" }).transformSync(${JSON.stringify(source)});
      } catch (e) {
        threw = e;
      }
      if (!threw) throw new Error("expected a parse error");
      const errors = threw.errors ?? [threw];
      if (!errors.some(e => String(e.message).includes("has already been declared"))) {
        throw new Error("expected 'already declared', got: " + errors.map(e => e.message).join(" | "));
      }
      console.log("OK " + errors.length);
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (exitCode !== 0) {
      expect(stderr).toBe("");
    }
    expect(stdout.trim()).toMatch(/^OK \d+$/);
    expect(exitCode).toBe(0);
  });
});
