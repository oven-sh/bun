// Records expected.json: the messages of ESLint about `text` in plugin.cjs, with all of its rules.
//
//   bun record.mjs --eslint=<directory of eslint 10.12.0>
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const directory = process.argv.find(it => it.startsWith("--eslint=")).slice("--eslint=".length);
const { Linter } = require(path.join(directory, "lib/api.js"));
const demo = require("./plugin.cjs");

const rules = Object.fromEntries(Object.keys(demo.rules).map(name => [`demo/${name}`, "error"]));
const messages = new Linter().verify(demo.text, [{ files: ["**"], plugins: { demo }, rules }], { filename: "a.js" });
fs.writeFileSync(path.join(import.meta.dirname, "expected.json"), `${JSON.stringify(messages, null, 1)}\n`);
