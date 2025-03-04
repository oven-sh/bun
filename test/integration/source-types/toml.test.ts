import path from "node:path";
import { promises as fs } from "node:fs";

const fixturePath = (...segs: string[]) => path.resolve(import.meta.dirname, "fixtures", "toml", ...segs);

test("Bun.TOML", async () => {
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
      const source = await fs.readFile(filepath);
      yield { filename: tomlFile, source };
    }
  }

  for await (const { filename, source } of iterCases(fixturePath("valid"))) {
    try {
      const result = await Bun.TOML.parse(source);
      metrics.valid.pass++;
      validInfo += `pass: valid/${filename}\n`;
    } catch (e) {
      metrics.valid.fail++;
      const errInfo = String(e)
        .split("\n")
        .map(line => "  " + line)
        .join("\n");
      validInfo += `fail: valid/${filename}\n${errInfo}\n`;
    }
  }

  for await (const { filename, source } of iterCases(fixturePath("invalid"))) {
    try {
      const result = await Bun.TOML.parse(source);
      metrics.invalid.fail++;
      invalidInfo += `expected syntax error: invalid/${filename}\n`;
    } catch (e) {
      metrics.invalid.pass++;
      invalidInfo += `pass: invalid/${filename}\n`;
    }
  }

  const passTotal = metrics.valid.pass + metrics.invalid.pass;
  const failTotal = metrics.valid.fail + metrics.invalid.fail;
  const pct = (pass, total, precision = 2) => ((pass / total) * 100).toFixed(precision);

  const snapshot = [
    "Bun.TOML.parse test suite",
    `valid passing:   ${pct(metrics.valid.pass, passTotal)}% (${metrics.valid.pass}/${passTotal})`,
    `invalid passing: ${pct(metrics.invalid.pass, passTotal)}% (${metrics.invalid.pass}/${passTotal})`,
    "",
    validInfo,
    invalidInfo,
  ].join("\n");
  expect(snapshot).toMatchSnapshot();
});
