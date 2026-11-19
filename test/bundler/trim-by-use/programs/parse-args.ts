// util.parseArgs
import { parseArgs } from "node:util";
const parsed = parseArgs({
  args: ["-f", "--bar", "b", "--no-color", "rest", "--", "-x"],
  options: { f: { type: "boolean", short: "f" }, bar: { type: "string" }, color: { type: "boolean" } },
  allowPositionals: true,
  allowNegative: true,
  tokens: true,
});
console.log(JSON.stringify(parsed.values), JSON.stringify(parsed.positionals), parsed.tokens!.length);
try {
  parseArgs({ args: ["--unknown"], options: {} });
} catch (error) {
  console.log((error as any).code);
}
