import { expect, test } from "bun:test";
import { bunEnv, bunExe, tls } from "harness";

test("HTTPS req.socket instanceof TLSSocket", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const https = require("node:https");
const tls = require("node:tls");
const net = require("node:net");

const server = https.createServer(
  { cert: process.env.TLS_CERT, key: process.env.TLS_KEY },
  (req, res) => {
    const results = {
      instanceOfTLSSocket: req.socket instanceof tls.TLSSocket,
      instanceOfNetSocket: req.socket instanceof net.Socket,
      encrypted: req.socket.encrypted,
    };
    res.end(JSON.stringify(results));
    server.close();
  }
);

server.listen(0, () => {
  const port = server.address().port;
  https.get("https://localhost:" + port, { rejectUnauthorized: false }, (res) => {
    let data = "";
    res.on("data", (chunk) => data += chunk);
    res.on("end", () => {
      console.log(data);
    });
  });
});
`,
    ],
    env: { ...bunEnv, TLS_CERT: tls.cert, TLS_KEY: tls.key },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) {
    throw new Error(`Process exited with code ${exitCode}: ${stderr}`);
  }
  const results = JSON.parse(stdout.trim());
  expect(results.instanceOfTLSSocket).toBe(true);
  expect(results.instanceOfNetSocket).toBe(true);
  expect(results.encrypted).toBe(true);
});

test("HTTP req.socket instanceof net.Socket", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const http = require("node:http");
const tls = require("node:tls");
const net = require("node:net");

const server = http.createServer((req, res) => {
  const results = {
    instanceOfTLSSocket: req.socket instanceof tls.TLSSocket,
    instanceOfNetSocket: req.socket instanceof net.Socket,
    encrypted: !!req.socket.encrypted,
  };
  res.end(JSON.stringify(results));
  server.close();
});

server.listen(0, () => {
  const port = server.address().port;
  http.get("http://localhost:" + port, (res) => {
    let data = "";
    res.on("data", (chunk) => data += chunk);
    res.on("end", () => {
      console.log(data);
    });
  });
});
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) {
    throw new Error(`Process exited with code ${exitCode}: ${stderr}`);
  }
  const results = JSON.parse(stdout.trim());
  expect(results.instanceOfTLSSocket).toBe(false);
  expect(results.instanceOfNetSocket).toBe(true);
  expect(results.encrypted).toBe(false);
});
