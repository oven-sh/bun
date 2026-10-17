// This test serves two purposes:
// 1. If previously seen files are rebuilt, the second time it is rebuilt, we
//    read the directory entries from the filesystem again.
//
//    That way, if the developer changes a file, we will see the change.
//
// 2. Checks the file descriptor count to make sure we're not leaking any files between re-builds.

import { closeSync, openSync, realpathSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const tmp = realpathSync(process.env.BUNDLER_RELOADER_SCRIPT_TMP_DIR || tmpdir());
const input = join(tmp, "input.js");
const mutate = join(tmp, "mutate.js");
try {
  unlinkSync(mutate);
} catch (e) {}
await Bun.write(input, "import value from './mutate.js';\n" + `export default value;` + "\n");

const missingImport = 'Could not resolve: "./mutate.js"';
const first = await Bun.build({
  entrypoints: [input],
  throw: false,
});
// The first build must fail because mutate.js does not exist yet, and for no other reason.
const firstLogs = first.logs.map(log => log.message);
if (first.success || firstLogs.join("\n") !== missingImport) {
  throw new Error("Expected the first build to fail on the missing import, but got\n\n" + JSON.stringify(firstLogs));
}
await Bun.write(mutate, "export default 1;\n");

const maxfd = openSync(process.execPath, 0);
closeSync(maxfd);

// A cached directory listing is re-read when the resolver's generation is newer
// than the listing's, not when mtime changes. The bundle thread advances the
// generation once per queue drain, after it has posted the previous result to
// JS, so a build enqueued before that happens runs at the previous generation
// and still reuses the stale listing (#38212 moves the advance to once per
// build). Retry until a build runs at a newer generation. A listing that is
// never refreshed keeps failing until the deadline.
let text: string | undefined;
for (const deadline = Date.now() + 10_000; ; ) {
  const second = await Bun.build({
    entrypoints: [input],
    throw: false,
  });
  if (second.success) {
    text = await second.outputs[0].text();
    break;
  }
  const secondLogs = second.logs.map(log => log.message);
  if (secondLogs.join("\n") !== missingImport || Date.now() > deadline) {
    throw new Error("Expected the rebuild to see mutate.js, but got\n\n" + JSON.stringify(secondLogs));
  }
  await Bun.sleep(10);
}

if (!text?.includes?.(" = 1")) {
  throw new Error("Expected text to include ' = 1', but received\n\n" + text);
}

const newMax = openSync(process.execPath, 0);
if (newMax !== maxfd) {
  throw new Error("File descriptors leaked! Expected " + maxfd + " but got " + newMax + "");
}

console.log("OK");
process.exit(0);
