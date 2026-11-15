import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import emptyYaml from "./yaml-empty.yaml";
import yamlFromCustomTypeAttribute from "./yaml-fixture.yaml.txt" with { type: "yaml" };

const expectedYamlFixture = {
  framework: "next",
  bundle: {
    packages: {
      "@emotion/react": true,
    },
  },
  array: [
    {
      entry_one: "one",
      entry_two: "two",
    },
    {
      entry_one: "three",
      nested: [
        {
          entry_one: "four",
        },
      ],
    },
  ],
  dev: {
    one: {
      two: {
        three: 4,
      },
    },
    foo: 123,
    "foo.bar": "baz",
  },
};

const expectedYmlFixture = {
  framework: "next",
  bundle: {
    packages: {
      "@emotion/react": true,
    },
  },
};

it("via dynamic import", async () => {
  const yaml = (await import("./yaml-fixture.yaml")).default;
  expect(yaml).toEqual(expectedYamlFixture);
});

it("via import type yaml", async () => {
  expect(yamlFromCustomTypeAttribute).toEqual(expectedYmlFixture);
});

it("via dynamic import with type attribute", async () => {
  delete require.cache[require.resolve("./yaml-fixture.yaml.txt")];
  const yaml = (await import("./yaml-fixture.yaml.txt", { with: { type: "yaml" } })).default;
  expect(yaml).toEqual(expectedYmlFixture);
});

it("empty via import statement", () => {
  // Empty YAML file with just a comment should return null
  expect(emptyYaml).toBe(null);
});

it("yml extension works", async () => {
  const yaml = (await import("./yaml-fixture.yml")).default;
  expect(yaml).toEqual(expectedYmlFixture);
});

describe.concurrent("values are intact when toString() of a sequence key", () => {
  /** A `// @bun` module: its inline source map is parsed when a stack trace is first remapped. */
  function withSourceMap(code) {
    const map = { version: 3, sources: ["original.ts"], sourcesContent: [code], mappings: ";AAAA", names: [] };
    const url = `data:application/json;base64,${btoa(JSON.stringify(map))}`;
    return `// @bun @bun-cjs\n(function(exports, require, module) {${code}})\n//# sourceMappingURL=${url}\n`;
  }

  async function requireYaml(setup, toStringBody) {
    using dir = tempDir("yaml-import-nested-parse", {
      "data.yaml": "? [x]\n: 1\nb: hello\nc: {d: [1, 2, 3], e: world}\n",
      "other.ts": Array.from({ length: 50 }, (_, i) => `export const a${i} = String({ x: "v${i}" }.x);`).join("\n"),
      "called1.cjs": withSourceMap(`exports.error = function () { return new Error("1"); };`),
      "called2.cjs": withSourceMap(`exports.error = function () { return new Error("2"); };`),
      "dropped1.cjs": withSourceMap(`exports.error = (() => new Error("3"))();`),
      "dropped2.cjs": withSourceMap(`exports.error = (() => new Error("4"))();`),
      "main.js": `
        ${setup}
        Array.prototype.toString = () => { ${toStringBody}; return "k"; };
        console.log(JSON.stringify(require("./data.yaml")));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  it.each([
    ["requires another module", ``, `require("./other.ts")`],
    [
      "reads error.stack, which parses a source map",
      `const errors = [require("./called1.cjs").error(), require("./called2.cjs").error()];`,
      `errors.forEach(error => error.stack)`,
    ],
    [
      "runs a GC, which computes error.stack and parses a source map",
      `globalThis.errors = [require("./dropped1.cjs").error, require("./dropped2.cjs").error];`,
      `Bun.gc(true)`,
    ],
  ])("%s", async (_, setup, toStringBody) => {
    expect(await requireYaml(setup, toStringBody)).toEqual({
      stdout: `{"k":1,"b":"hello","c":{"d":[1,2,3],"e":"world"}}\n`,
      stderr: "",
      exitCode: 0,
    });
  });
});
