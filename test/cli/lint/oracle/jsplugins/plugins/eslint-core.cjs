// The rules of ESLint itself as a plugin: they are written against the same API as any other.
//
//   ESLINT_DIR=<eslint checkout>
const { readdirSync } = require("node:fs");
const { join } = require("node:path");

const directory = join(process.env.ESLINT_DIR, "lib/rules");
const rules = {};
for (const file of readdirSync(directory)) {
  if (file.endsWith(".js") && file !== "index.js") rules[file.slice(0, -3)] = require(join(directory, file));
}
module.exports = { meta: { name: "core" }, rules };
