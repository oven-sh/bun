import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The property is an own double in three structures and a constant of the prototype in a fourth. The
// fourth runs only before the value profile is read, so the FTL expects a number.
const uses = {
  "a variable": `let x = d * 0.5; if (c) x = o.p; x * 1.5; return typeof x + " " + x;`,
  "a conditional": `const x = c ? o.p : d * 0.5; x * 1.5; return typeof x + " " + x;`,
  "a global variable": `const y = o.p; y * 1.5; variable = y; return typeof variable + " " + variable;`,
  "an OSR exit": `const y = o.p; const z = y * 1.5; if (c === 2) { cold.q.q; return typeof y + " " + y; } return z;`,
};
const outputs = { null: "object null", undefined: "undefined undefined", true: "boolean true", false: "boolean false" };

for (const [name, body] of Object.entries(uses)) {
  test.concurrent.each(Object.entries(outputs))(`${name}, %s`, async (value, output) => {
    const source = `
      function First(p) { this.a = 1; this.p = p; }
      function Second(p) { this.p = p; }
      function Third(p) { this.b = 1; this.c = 2; this.p = p; }
      const object = Object.create({ p: ${value} }), cold = { q: { q: 1 } };
      let variable = 1.5;
      function f(o, c, d) { ${body} }
      const early = [42, 47, 53, 61];
      for (let i = 0; i < 100000; i++)
        f(early.includes(i) ? object : i % 3 === 0 ? new First(i + 0.5) : i % 3 === 1 ? new Second(i + 0.5) : new Third(i + 0.5), 1, i + 0.5);
      console.log(f(object, 2, 1.5));`;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: { ...bunEnv, BUN_JSC_useConcurrentJIT: "0" },
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe(output + "\n");
    expect(exitCode).toBe(0);
  });
}
