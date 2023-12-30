import { describe, expect, test } from "bun:test";
import { spawnSync } from "bun";
import { bunExe, bunEnv } from "harness";

describe("console.table", () => {
  test("throws when second arg is invalid", () => {
    expect(() => console.table({})).not.toThrow();
    expect(() => console.table({}, [])).not.toThrow();
    // @ts-expect-error
    expect(() => console.table({}, "invalid")).toThrow();
  });

  test.each([
    [
      "not object (number)",
      {
        args: () => [42],
        output: `42\n`,
      },
    ],
    [
      "not object (string)",
      {
        args: () => ["bun"],
        output: `bun\n`,
      },
    ],
    [
      "object - empty",
      {
        args: () => [{}],
        output: `┌─────────┐
│ (index) │
├─────────┤
└─────────┘
`,
      },
    ],
    [
      "object",
      {
        args: () => [{ a: 42, b: "bun" }],
        output: `┌─────────┬────────┐
│ (index) │ Values │
├─────────┼────────┤
│    a    │   42   │
│    b    │ "bun"  │
└─────────┴────────┘
`,
      },
    ],
    [
      "array - empty",
      {
        args: () => [[]],
        output: `┌─────────┐
│ (index) │
├─────────┤
└─────────┘
`,
      },
    ],
    [
      "array - plain",
      {
        args: () => [[42, "bun"]],
        output: `┌─────────┬────────┐
│ (index) │ Values │
├─────────┼────────┤
│    0    │   42   │
│    1    │ "bun"  │
└─────────┴────────┘
`,
      },
    ],
    [
      "array - object",
      {
        args: () => [[{ a: 42, b: "bun" }]],
        output: `┌─────────┬────┬───────┐
│ (index) │ a  │   b   │
├─────────┼────┼───────┤
│    0    │ 42 │ "bun" │
└─────────┴────┴───────┘
`,
      },
    ],
    [
      "array - objects with diff props",
      {
        args: () => [[{ b: "bun" }, { a: 42 }]],
        output: `┌─────────┬───────┬────┐
│ (index) │   b   │ a  │
├─────────┼───────┼────┤
│    0    │ "bun" │    │
│    1    │       │ 42 │
└─────────┴───────┴────┘
`,
      },
    ],
    [
      "array - mixed",
      {
        args: () => [[{ a: 42, b: "bun" }, 42]],
        output: `┌─────────┬────┬───────┬────────┐
│ (index) │ a  │   b   │ Values │
├─────────┼────┼───────┼────────┤
│    0    │ 42 │ "bun" │        │
│    1    │    │       │   42   │
└─────────┴────┴───────┴────────┘
`,
      },
    ],
    [
      "set",
      {
        args: () => [new Set([42, "bun"])],
        output: `┌───────────────────┬────────┐
│ (iteration index) │ Values │
├───────────────────┼────────┤
│         0         │   42   │
│         1         │ "bun"  │
└───────────────────┴────────┘
`,
      },
    ],
    [
      "map",
      {
        args: () => [
          new Map<any, any>([
            ["a", 42],
            ["b", "bun"],
            [42, "c"],
          ]),
        ],
        output: `┌───────────────────┬─────┬────────┐
│ (iteration index) │ Key │ Values │
├───────────────────┼─────┼────────┤
│         0         │ "a" │   42   │
│         1         │ "b" │ "bun"  │
│         2         │ 42  │  "c"   │
└───────────────────┴─────┴────────┘
`,
      },
    ],
    [
      "properties",
      {
        args: () => [[{ a: 42, b: "bun" }], ["b", "c", "a"]],
        output: `┌─────────┬───────┬───┬────┐
│ (index) │   b   │ c │ a  │
├─────────┼───────┼───┼────┤
│    0    │ "bun" │   │ 42 │
└─────────┴───────┴───┴────┘
`,
      },
    ],
    [
      "properties - empty",
      {
        args: () => [[{ a: 42, b: "bun" }], []],
        output: `┌─────────┐
│ (index) │
├─────────┤
│    0    │
└─────────┘
`,
      },
    ],
    [
      "values - array",
      {
        args: () => [
          [
            { value: { a: 42, b: "bun" } },
            { value: [42, "bun"] },
            { value: new Set([42, "bun"]) },
            {
              value: new Map<any, any>([
                [42, "bun"],
                ["bun", 42],
              ]),
            },
          ],
        ],
        output: `┌─────────┬─────────────────────────────────┐
│ (index) │              value              │
├─────────┼─────────────────────────────────┤
│    0    │       { a: 42, b: "bun" }       │
│    1    │          [ 42, "bun" ]          │
│    2    │      Set(2) { 42, "bun" }       │
│    3    │ Map(2) { 42: "bun", "bun": 42 } │
└─────────┴─────────────────────────────────┘
`,
      },
    ],
  ])("expected output for: %s", (label, { args, output }) => {
    const { stdout } = spawnSync({
      cmd: [bunExe(), `${import.meta.dir}/console-table-run.ts`, args.toString()],
      stdout: "pipe",
      stderr: "inherit",
      env: bunEnv,
    });

    const actualOutput = stdout.toString();
    expect(actualOutput).toBe(output);
  });
});
