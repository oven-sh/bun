// The class of the sockets that node:http's server hands out is written over `Socket` of node:net, a constructor function in another of Bun's
// modules. It names that function's layout as its base in the program that the front end writes, so its objects hold what EventEmitter, Readable
// and Writable lay on them where every other stream holds it. What a program gets that has stored another class in net.Socket is held by
// parallel/what-stands-above-the-socket-of-an-http-server; without the base those programs would hold nothing.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./engine/testaot";
import { without } from "./harness/capabilities";
import { built, spawned } from "./harness/commands";
import { buildFlags, compileCommand, withProgramOutput } from "./harness/flags";
import { test } from "./supported";

const program = `
const server = require("node:http").createServer((request, response) => response.end("ok"));
server.listen(0, () => server.close());
`;

const declared = without("testaot") ? test.skip : test;

declared("the layout of net's Socket is the base of the class of a server's sockets", async () => {
  using folder = tempDir("aot-the-socket-of-an-http-server", { "main.cjs": program });
  const file = join(String(folder), "program.aot");
  const flags = [withProgramOutput(file), buildFlags.withoutExecutable];
  built(await spawned([bunExe(), ...compileCommand, ...flags, "main.cjs"], String(folder), bunEnv));
  const { lines, stderr, exitCode } = await run("print", file);
  expect({ stderr, exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });

  const moduleOf = (name: string) =>
    lines
      .filter(line => line.startsWith("module ") && line.includes(` displayPath="${name}"`))
      .map(line => line.split(" ")[1]);
  const socketsOf = (name: string) =>
    lines.filter(
      line =>
        line.startsWith("layout ") &&
        line.includes(' kind=Instance name="Socket" ') &&
        moduleOf(name).some(module => line.includes(` module=${module} `)),
    );
  expect(socketsOf("node:net").length).toBe(1);
  expect(socketsOf("node:_http_server").map(line => / base=(L\d+)/.exec(line)?.[1] ?? "no base")).toEqual([
    socketsOf("node:net")[0].split(" ")[1],
  ]);
});
