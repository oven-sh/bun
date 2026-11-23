// Under --aot-allow-code-from-disk the records that the library's INTERNAL files hand out stay in the compiler's sight, and the run time freezes such a record where anything but compiled code is
// handed it (an uncompiled file of the library that a file from disk has asked for). Nothing of that may be seen by a program: no public module, and nothing that hangs on one, is frozen that is
// not frozen in plain Bun, and a file from disk stores onto them as it always could. And every module of the library still loads from its text beside an image that holds node:tty, whose methods
// read what node:readline stores into internal/readline/callbacks: a record that another file stores into is not frozen.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "main.cjs": `
const http = require("node:http"), events = require("node:events"), stream = require("node:stream"), util = require("node:util"), net = require("node:net"), tty = require("node:tty");
const server = http.createServer((request, response) => response.end("ok"));
console.log("the program sees:", [http, events, stream, util, net, tty, http.Server.prototype, stream.Readable.prototype, events.prototype, tty.WriteStream.prototype, util.types, util.inspect].map(Object.isFrozen).join());
require(require("node:path").resolve(process.argv[2]));
server.close();
`,
  "from-disk.cjs": `
const names = ["node:http", "node:events", "node:stream", "node:util", "node:net", "node:tty", "node:path", "node:fs", "node:url", "node:buffer", "node:http2", "node:readline", "node:zlib", "node:dgram", "node:child_process"];
const frozen = [];
for (const name of names) {
  const all = require(name);
  if (Object.isFrozen(all)) frozen.push(name);
  for (const key of Reflect.ownKeys(all)) {
    let value;
    try { value = all[key]; } catch { continue; }
    if (value && (typeof value === "object" || typeof value === "function") && Object.isFrozen(value)) frozen.push(name + "." + String(key));
  }
}
console.log("a file from disk sees frozen:", frozen.join() || "nothing");
const http = require("node:http");
http.marked = 1;
http.createServer.marked = 2;
require("node:events").prototype.marked = 3;
require("node:stream").Readable.prototype.marked = 4;
console.log("a file from disk stores:", http.marked, http.createServer.marked, new (require("node:events"))().marked, new (require("node:stream").Readable)().marked);
const readline = require("node:readline");
const asked = [];
readline.clearLine = (stream, direction) => asked.push(direction);
require("node:tty").WriteStream.prototype.clearLine.call({}, 1);
console.log("node:tty calls what stands on node:readline:", asked.join());
`,
};

test("what the library hands out looks and takes stores as in plain Bun where code from disk is allowed", async () => {
  using dir = tempDir("aot-what-the-library-hands-out", files);
  const cwd = String(dir);
  const plain = await run([bunExe(), "main.cjs", "./from-disk.cjs"], cwd, bunEnv);
  expect(plain.exitCode).toBe(0);
  expect(plain.stdout).toContain("node:tty calls what stands on node:readline: 1");
  const executable = join(cwd, "program");
  const build = [
    bunExe(),
    "build",
    "--compile",
    "--aot",
    "--aot-allow-code-from-disk",
    "main.cjs",
    "--outfile",
    executable,
  ];
  expect((await run(build, cwd, bunEnv)).exitCode).toBe(0);
  const compiled = await run([executable, "./from-disk.cjs"], cwd, bunEnv);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
}, 240_000);
