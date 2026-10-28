// Built-in modules are shared by the Bun.ModuleGraphs of a thread, and an Agent opens its sockets as whoever made it. So the agent that
// node:http's requests use by default is made as the module loads, by the host. Made at its first use, it would belong to the graph that
// happened to send the first request, and once that graph is disposed no request of anybody else through it would ever be answered.
import { expect, setDefaultTimeout } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { describe, test } from "./supported";

setDefaultTimeout(120_000);

const main = `
import http from "node:http";
import https from "node:https";

const server = http.createServer((request, response) => response.end("answer to " + request.url));
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

function get(path) {
  const { promise, resolve } = Promise.withResolvers();
  const request = http.get({ host: "127.0.0.1", port, path }, response => {
    let text = "";
    response.on("data", piece => (text += piece));
    response.on("end", () => resolve(text));
  });
  request.on("error", error => resolve("error: " + error.code));
  return promise;
}
function orNothing(promise) {
  const { promise: late, resolve } = Promise.withResolvers();
  const timer = setTimeout(resolve, 5000, "no answer");
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

const first = new Bun.ModuleGraph();
console.log("first:", await orNothing(first.run(get, "/first")));
first.dispose();

const second = new Bun.ModuleGraph();
console.log("second:", await orNothing(second.run(get, "/second")));
console.log("second again:", await orNothing(second.run(get, "/second-again")));
console.log("the host:", await orNothing(get("/host")));
second.dispose();
console.log("the host again:", await orNothing(get("/host-again")));

const third = new Bun.ModuleGraph();
console.log("one agent for all:", third.run(() => http.globalAgent) === http.globalAgent, third.run(() => https.globalAgent) === https.globalAgent);
third.dispose();
http.globalAgent.destroy();
server.close();
`;
const expected = `first: answer to /first
second: answer to /second
second again: answer to /second-again
the host: answer to /host
the host again: answer to /host-again
one agent for all: true true
`;

async function run(cmd: string[], cwd: string) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd);
  return { stdout, errors: stderr.split("\n").filter(line => /^(error|panic)\b/.test(line)), exitCode };
}

describe("a request through the default agent is answered after the graph that sent the first one is disposed", () => {
  test("from the sources", async () => {
    using dir = tempDir("default-agent-of-graphs", { "main.mjs": main });
    expect(await run([bunExe(), "main.mjs"], String(dir))).toEqual({ stdout: expected, errors: [], exitCode: 0 });
  });
  test("compiled", async () => {
    using dir = tempDir("default-agent-of-graphs", { "main.mjs": main });
    const outfile = isWindows ? "app.exe" : "app";
    expect(
      await run([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", outfile], String(dir)),
    ).toMatchObject({ errors: [], exitCode: 0 });
    expect(await run([join(String(dir), outfile)], String(dir))).toEqual({ stdout: expected, errors: [], exitCode: 0 });
  });
});
