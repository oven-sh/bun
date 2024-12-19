/**
 * @note cwd set to temp dir by spawning test
 * @see fs-writeFile-child-process.test.ts
 */
const { writeFileSync } = require("node:fs");

writeFileSync(__filename, "please don't override this source file");
process.stdout.write(process.cwd());
