import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("stream.finished callback preserves AsyncLocalStorage context", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const asyncHooks = require('async_hooks');
const http = require('http');
const finished = require('stream').finished;

const asyncLocalStorage = new asyncHooks.AsyncLocalStorage();
const store = { foo: 'bar' };

const server = http.createServer(function (req, res) {
  asyncLocalStorage.run(store, function () {
    finished(res, function () {
      const value = asyncLocalStorage.getStore()?.foo;
      if (value !== 'bar') {
        console.log('FAIL: expected "bar" but got ' + value);
        process.exitCode = 1;
      } else {
        console.log('PASS');
      }
    });
  });
  setTimeout(res.end.bind(res), 0);
}).listen(0, function () {
  const port = this.address().port;
  http.get('http://127.0.0.1:' + port, function onResponse(res) {
    res.resume();
    res.on('end', server.close.bind(server));
  });
});
`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("PASS");
  expect(exitCode).toBe(0);
});
