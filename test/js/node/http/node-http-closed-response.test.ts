import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The second of four requests on one connection closes its response between write() and end(), or behind end().
const script = `
  const { once } = require("node:events");
  const http = require("node:http");
  const { LEVEL: level, MOMENT: moment } = process.env;
  const lines = [];
  const nameOf = frame => (frame.includes(" (") ? frame.slice(3, frame.indexOf(" (")) : frame.slice(3).replace(/^.*:\\d+$/, ""));
  const namesIn = error => error.stack.split("\\n").slice(1).map(line => nameOf(line.trim()));
  process.on("uncaughtException", error => lines.push("uncaught in " + namesIn(error).join(" < ") + ": " + error.message));
  let turn = 0;
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    const index = turn++;
    sockets.add(request.socket);
    request.resume();
    response.on("finish", () => lines.push("finish " + index));
    response.on("close", () => lines.push("close " + index));
    response.setHeader("x-turn", String(index));
    response.write("first ");
    if (index === 1 && moment === "during") Object[level](response);
    response.end("last");
    if (index === 1 && moment === "after") Object[level](response);
  });
  (async () => {
    await once(server.listen(0, "127.0.0.1"), "listening");
    for (let index = 0; index < 4; index++) {
      const answer = await fetch("http://127.0.0.1:" + server.address().port, { method: "POST", body: "body" });
      console.log(answer.status, answer.headers.get("x-turn"), JSON.stringify(await answer.text()));
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    console.log("connections", sockets.size);
    console.log(lines.filter(line => !/ [023]$/.test(line)).join("\\n"));
    server.closeAllConnections();
    server.close();
  })();
`;

async function run(level: string, moment: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, LEVEL: level, MOMENT: moment },
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(exitCode).toBe(0);
  return stdout.trim().split("\n");
}

const readonly = "Attempted to assign to readonly property.";
const notExtensible = "Attempting to define property on object that is not extensible.";
const fourAnswersOnOneConnection = [
  '200 0 "first last"',
  '200 1 "first last"',
  '200 2 "first last"',
  '200 3 "first last"',
  "connections 1",
];

test("a response frozen between write() and end() keeps its socket, and the next request on the connection is refused", async () => {
  expect(await run("freeze", "during")).toEqual([
    '200 0 "first last"',
    '200 1 "first last"',
    '200 null ""',
    '200 2 "first last"',
    "connections 2",
    `uncaught in <anonymous> < <anonymous> < emit < onNodeHTTPRequest: ${readonly}`,
    `uncaught in flushWriteAccountingNT < processTicksAndRejections: ${readonly}`,
    "uncaught in unknown < assignSocketInternal < onNodeHTTPRequest: ServerResponse has an already assigned socket",
    `uncaught in emitCloseNT < emit < emitCloseNT < processTicksAndRejections: ${readonly}`,
  ]);
});

test("each step behind the end() of a response that is then frozen reports the store it could not make", async () => {
  expect(await run("freeze", "after")).toEqual([
    ...fourAnswersOnOneConnection,
    `uncaught in onNodeHTTPRequest: ${readonly}`,
    `uncaught in flushWriteAccountingNT < processTicksAndRejections: ${readonly}`,
    `uncaught in markResponseEndedNT < processTicksAndRejections: ${notExtensible}`,
    `uncaught in set < <anonymous> < emitResponseFinish < emit < emitResponseFinished < processTicksAndRejections: ${readonly}`,
    `uncaught in emitCloseNT < processTicksAndRejections: ${readonly}`,
  ]);
});

test.each([
  ["seal", "during"],
  ["seal", "after"],
  ["preventExtensions", "during"],
  ["preventExtensions", "after"],
])("a response closed by Object.%s %s its end() still emits 'finish' and 'close'", async (level, moment) => {
  expect(await run(level, moment)).toEqual([
    ...fourAnswersOnOneConnection,
    `uncaught in onNodeHTTPRequest: ${notExtensible}`,
    `uncaught in markResponseEndedNT < processTicksAndRejections: ${notExtensible}`,
    "finish 1",
    "close 1",
  ]);
});
