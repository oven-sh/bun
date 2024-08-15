// This test serves two purposes:
// 1. If previously seen files are rebuilt, the second time it is rebuilt, we
//    read the directory entries from the filesystem again.
//
//    That way, if the developer changes a file, we will see the change.
//
// 2. Checks the file descriptor count to make sure we're not leaking any files between re-builds.

import { tmpdir } from "os";
import { realpathSync, unlinkSync } from "fs";
import { join } from "path";
import { openSync, closeSync } from "fs";

const tmp = realpathSync(tmpdir());
const input = join(tmp, "input.js");
const mutate = join(tmp, "mutate.js");
try {
  unlinkSync(mutate);
} catch (e) {}
await Bun.write(input, "import value from './mutate.js';\n" + `export default value;` + "\n");

await Bun.build({
  entrypoints: [input],
});
await Bun.write(mutate, "export default 1;\n");

const maxfd = openSync(process.execPath, 0);
closeSync(maxfd);
const { outputs: second } = await Bun.build({
  entrypoints: [input],
});
const text = await second.values().next().value?.text();

if (!text?.includes?.(" = 1")) {
  throw new Error("Expected text to include ' = 1', but received\n\n" + text);
}

const newMax = openSync(process.execPath, 0);
if (newMax !== maxfd) {
  throw new Error("File descriptors leaked! Expected " + maxfd + " but got " + newMax + "");
}

process.exit(0);
