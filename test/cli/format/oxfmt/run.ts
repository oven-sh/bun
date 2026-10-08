// oxfmt's fixtures, judged by Prettier and by oxfmt's own snapshots. See README.md.
//
//   bun test/cli/format/oxfmt/run.ts --bin=<bun-lint> [--list] [--filter=text]
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extract, readBundle } from "../bundle.ts";
import { display, isInput, parse, rowsOf } from "./fixtures.ts";

const flags = new Map(process.argv.slice(2).map(arg => /^--([\w-]+)(?:=(.*))?$/s.exec(arg)!).map(match => [match[1], match[2] ?? "true"]));
const bin = flags.get("bin");
if (!bin) {
  console.error("usage: bun run.ts --bin=<bun-lint> [--list] [--filter=text]");
  process.exit(1);
}
const bundle = join(import.meta.dir, "bundle.zst");
const files = readBundle(bundle);
const directory = mkdtempSync(join(tmpdir(), "oxfmt-fixtures-"));
extract(bundle, "", directory);

const tally = { prettier: [0, 0], oxfmt: [0, 0], same: 0 };
for (const name of files.keys()) {
  if (!isInput(name) || !name.includes(flags.get("filter") ?? "")) continue;
  const expected = {
    prettier: parse(files.get(`${name}.prettier.snap`)!.toString()),
    oxfmt: parse(files.get(`${name}.snap`)!.toString()),
  };
  for (const options of rowsOf(name, files)) {
    const key = display(options);
    if (expected.prettier.get(key) === expected.oxfmt.get(key)) tally.same++;
    for (const flavor of ["prettier", "oxfmt"] as const) {
      const args = Object.entries(options).filter(([, value]) => typeof value !== "object");
      const { stdout } = Bun.spawnSync({
        cmd: [bin, "format", "file", join(directory, name), `--flavor=${flavor}`, ...args.map(([name, value]) => `--${name}=${value}`)],
      });
      const output = stdout.toString();
      const passed = output === expected[flavor].get(key) || (output === "SyntaxError\n" && expected[flavor].get(key) === "<SyntaxError>");
      tally[flavor][0] += Number(passed);
      tally[flavor][1]++;
      if (!passed && flags.has("list")) console.log(`${flavor}: ${name} ${key}`);
    }
  }
}
rmSync(directory, { recursive: true, force: true });
console.log(`as Prettier prints them: ${tally.prettier.join("/")}`);
console.log(`as oxfmt prints them, with its flavor: ${tally.oxfmt.join("/")}`);
console.log(`Prettier and oxfmt agree on ${tally.same} of ${tally.prettier[1]}`);
