const { copyFileSync } = require("node:fs");

copyFileSync(process.argv.at(-2), process.argv.at(-1));
