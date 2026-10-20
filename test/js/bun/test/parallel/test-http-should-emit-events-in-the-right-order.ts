import { bunEnv, bunExe } from "harness";
import { createTest } from "node-harness";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";
const { expect } = createTest(import.meta.path);

const server = createServer((req, res) => res.end("hello")).listen(0, "127.0.0.1");
await once(server, "listening");
const { port } = server.address() as AddressInfo;

const { stdout, exited } = Bun.spawn({
  cmd: [bunExe(), "run", path.join(import.meta.dir, "../../../node/http/fixtures/log-events.mjs"), String(port)],
  stdout: "pipe",
  stdin: "ignore",
  stderr: "inherit",
  env: bunEnv,
});
const out = await stdout.text();
// This matches the order Node.js emits these events in.
expect(
  out
    .split("\n")
    .filter(Boolean)
    .map(x => JSON.parse(x)),
).toStrictEqual([
  ["req", "socket"],
  ["req", "prefinish"],
  ["req", "finish"],
  ["req", "response"],
  "STATUS: 200",
  ["res", "resume"],
  ["res", "readable"],
  ["res", "end"],
  ["req", "close"],
  ["res", "close"],
]);
expect(await exited).toBe(0);
server.close();
