// Passes as it is under `node`. Bun does not report that `only` needs the flag.
import assert from "node:assert";
import { run } from "node:test";

const messages = [];
for await (const { type, data } of run({ files: [new URL("./08-only-no-op.js", import.meta.url).pathname] })) {
  if (type === "test:diagnostic") messages.push(data.message);
}
assert.ok(messages.includes("'only' and 'runOnly' require the --test-only command-line option."), messages.join("\n"));
