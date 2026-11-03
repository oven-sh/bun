// Prints what extract() makes of every case, each in a directory of its own under the one given.
import { join } from "node:path";
import { loadCases, observeExtract, type Case } from "./observe";

process.umask(0o022);
const cases = await loadCases<Case>(join(import.meta.dir, "cases.json.gz"));
const observed = await Promise.all(
  cases.map((c, index) => observeExtract(Buffer.from(c.data, "base64"), join(process.argv[2], String(index)))),
);
console.log(JSON.stringify(observed));
