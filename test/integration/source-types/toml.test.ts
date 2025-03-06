import path from "node:path";
import { promises as fs } from "node:fs";
import { isCI } from "harness";

const debugLogs = !isCI;

const fixturePath = (...segs: string[]) => path.resolve(import.meta.dirname, "fixtures", "toml", ...segs);
type TestCase = {
  /** relative file path. Relative w.r.t. valid/ and invalid/ */
  filename: string;
  /** absolute path to file */
  filepath: string;
  /** source code read from disk. `undefined` if `needsSource` is false */
  source: string | undefined;
};

async function doTest(
  { name, needsSource = true }: { name: string; needsSource?: boolean },
  run: (testCast: TestCase) => Promise<void>,
): Promise<void> {
  const glob = new Bun.Glob("**/*.{toml,json}"); // TODO: .multi

  let metrics = {
    valid: {
      pass: 0,
      fail: 0,
    },
    invalid: {
      pass: 0,
      fail: 0,
    },
  };

  let validInfo = "";
  let invalidInfo = "";

  async function* iterCases(dir: string) {
    for await (const tomlFile of await glob.scan(dir)) {
      const filepath = path.resolve(dir, tomlFile);
      // const fullpath = path.resolve(import.meta.dirname, filepath);
      const source = needsSource ? await fs.readFile(filepath, "utf8") : undefined;
      if (debugLogs) console.log(tomlFile);
      yield { filename: tomlFile, filepath, source };
    }
  }

  const stripPrefix = import.meta.dirname + "/";
  for await (const testCase of iterCases(fixturePath("valid"))) {
    const { filename } = testCase;
    try {
      const result = await run(testCase);
      metrics.valid.pass++;
      validInfo += `pass: valid/${filename}\n`;
    } catch (e) {
      metrics.valid.fail++;
      const errInfo = String(e)
        .split("\n")
        .map(line => "  " + line)
        // make absolute paths relative to the fixture directory
        .map(line => line.replaceAll(stripPrefix, ""))
        .join("\n");
      validInfo += `fail: valid/${filename}\n${errInfo}\n`;
    }
  }

  for await (const testCase of iterCases(fixturePath("invalid"))) {
    const { filename } = testCase;
    try {
      // const result = await Bun.TOML.parse(source);
      const result = await run(testCase);
      metrics.invalid.fail++;
      invalidInfo += `expected syntax error: invalid/${filename}\n`;
    } catch (e) {
      metrics.invalid.pass++;
      invalidInfo += `pass: invalid/${filename}\n`;
    }
  }

  const validTotal = metrics.valid.pass + metrics.valid.fail;
  const invalidTotal = metrics.invalid.pass + metrics.invalid.fail;

  const snapshot = [
    // "Bun.TOML.parse test suite",
    `suite: ${name}`,
    `valid passing:   ${pct(metrics.valid.pass, validTotal)}% (${metrics.valid.pass}/${validTotal})`,
    `invalid passing: ${pct(metrics.invalid.pass, invalidTotal)}% (${metrics.invalid.pass}/${invalidTotal})`,
    "",
    validInfo,
    invalidInfo,
  ].join("\n");
  expect(snapshot).toMatchSnapshot();
}
const pct = (pass: number, total: number, precision = 2) => ((pass / total) * 100).toFixed(precision);

describe("Bun.TOML.parse", () => {
  it.each([
    // basic values
    ["foo=bar", { foo: "bar" }],
    ["foo=1", { foo: 1 }],
    ["foo=true", { foo: true }],
    ["foo=[1,2,3]", { foo: [1, 2, 3] }],
    // strings
    ["foo='bar'", { foo: "bar" }],
    ["'foo'='bar'", { foo: "bar" }],
    [`'foo'='''bar'''`, { foo: "bar" }],

    ['[foo]\nbar="baz"', { foo: { bar: "baz" } }],
    ["[foo]\nbar=baz", { foo: { bar: "baz" } }],
    ["foo={bar=baz}", { foo: { bar: "baz" } }],

    // keys
    ["''='bar'", { "": "bar" }], // empty keys are valid but discouraged
    [`0=bar`, { "0": "bar" }],
  ])("bun.TOML.parse(`%s`) === %o", async (source, expected) => {
    const actual = await Bun.TOML.parse(source);
    console.log(actual);
    expect(actual).toStrictEqual(expected);
  });

  test("parses valid TOML without errors, and produces errors for invalid TOML", async () => {
    await doTest({ name: "Bun.TOML.parse", needsSource: true }, ({ source }) => Bun.TOML.parse(source as string));
  });
});

/**
 * ## FIXME
 * These tests pass when run with a release build, but trigger assertion
 * failures from WebKit.
 */
describe("import(*.toml)", () => {
  beforeAll(() => {
    // force .json files to use TOML loader
    Bun.plugin({
      name: "toml",
      setup(build) {
        build.onResolve({ filter: /\.json$/ }, args => {
          const path = resolve(dirname(args.importer), args.path);
          return { path, loader: "toml" };
        });
      },
    });
  });

  afterAll(() => {
    Bun.plugin.clearAll();
  });

  test("importing toml", async () => {
    await doTest({ name: "import", needsSource: false }, ({ filename }) => import(fixturePath("valid", filename)));
    // const glob = new Bun.Glob("**/*.{toml,json}"); // TODO: .multi
  });
});
