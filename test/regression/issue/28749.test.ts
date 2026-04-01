import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("http request with expect: 100-continue does not hang", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const http = require("http");

async function main() {
  const server = http.createServer((request, response) => response.end());
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  const stream = http.request(
    "http://localhost:" + port + "/",
    { headers: { "expect": "100-continue" } }
  );

  const errorPromise = new Promise((resolve, reject) => stream.addListener("error", reject));
  const continuePromise = new Promise(resolve => stream.addListener("continue", resolve));
  const responsePromise = new Promise(resolve => stream.addListener("response", resolve));

  await Promise.race([errorPromise, continuePromise]);
  console.log("continue");

  await Promise.race([errorPromise, responsePromise]);
  console.log("response");

  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  console.log("done");
}

main().catch(e => { console.error(e); process.exit(1); });
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("continue\nresponse\ndone\n");
  expect(exitCode).toBe(0);
});

test("http POST with expect: 100-continue and body works", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const http = require("http");

async function main() {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => { res.end("got:" + body); });
  });
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  const req = http.request("http://localhost:" + port + "/", {
    method: "POST",
    headers: { "expect": "100-continue" },
  });

  req.on("continue", () => {
    req.end("hello");
  });

  const res = await new Promise((resolve, reject) => {
    req.on("response", resolve);
    req.on("error", reject);
  });

  const data = await new Promise(resolve => {
    let d = "";
    res.on("data", chunk => d += chunk);
    res.on("end", () => resolve(d));
  });

  console.log(data);
  server.close();
}

main().catch(e => { console.error(e); process.exit(1); });
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("got:hello\n");
  expect(exitCode).toBe(0);
});
