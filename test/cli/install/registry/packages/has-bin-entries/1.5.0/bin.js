#!/usr/bin/env node

// for (let t = 2; t < process.argv.length; ++t) {
//   console.log(process.argv[t]);
// }

const fs = require("fs");
const path = require("path");

fs.appendFileSync(path.join(process.cwd(), "success.txt"), "success!");
