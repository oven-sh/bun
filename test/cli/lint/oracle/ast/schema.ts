// Compares the visitor keys of `bun-lint ast schema` with those of ESLint and typescript-eslint.
//
//   bun-lint ast schema | bun schema.ts <@typescript-eslint/visitor-keys> <eslint-visitor-keys>
import { resolve } from "node:path";

const [typescript, eslint] = process.argv.slice(2);
const { visitorKeys } = require(resolve(typescript));
const { KEYS } = require(resolve(eslint));
const ours = JSON.parse(await Bun.stdin.text());
let problems = 0;
const compare = (what: string, expected: Record<string, readonly string[]>, key: "keys" | "espreeKeys") => {
  for (const [type, keys] of Object.entries(expected)) {
    if (/^Experimental/.test(type)) continue;
    const actual = ours[type]?.[key];
    if (JSON.stringify(actual) !== JSON.stringify(keys)) {
      problems++;
      console.log(`${what} ${type}: expected ${keys.join(" ")}, actual ${actual?.join(" ")}`);
    }
  }
};
compare("typescript-eslint", visitorKeys, "keys");
compare("eslint", KEYS, "espreeKeys");
for (const type of Object.keys(ours)) if (!(type in visitorKeys)) (problems++, console.log(`unknown type ${type}`));
console.log(`${problems} problems`);
