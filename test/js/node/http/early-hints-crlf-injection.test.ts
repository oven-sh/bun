import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("writeEarlyHints", () => {
  test("rejects CRLF injection in header name", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require("node:http");
        const server = http.createServer((req, res) => {
          try {
            res.writeEarlyHints({
              link: "</style.css>; rel=preload",
              "x-custom\\r\\nSet-Cookie: session=evil\\r\\nX-Injected": "val",
            });
            console.log("FAIL: no error thrown");
            process.exit(1);
          } catch (e) {
            console.log("error_code:" + e.code);
            res.writeHead(200);
            res.end("ok");
          }
        });
        server.listen(0, () => {
          http.get({ port: server.address().port }, (res) => {
            let data = "";
            res.on("data", (c) => data += c);
            res.on("end", () => {
              console.log("body:" + data);
              server.close();
            });
          });
        });
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("error_code:ERR_INVALID_HTTP_TOKEN");
    expect(stdout).toContain("body:ok");
    expect(exitCode).toBe(0);
  });

  test("rejects CRLF injection in header value", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require("node:http");
        const server = http.createServer((req, res) => {
          try {
            res.writeEarlyHints({
              link: "</style.css>; rel=preload",
              "x-custom": "legitimate\\r\\nSet-Cookie: session=evil",
            });
            console.log("FAIL: no error thrown");
            process.exit(1);
          } catch (e) {
            console.log("error_code:" + e.code);
            res.writeHead(200);
            res.end("ok");
          }
        });
        server.listen(0, () => {
          http.get({ port: server.address().port }, (res) => {
            let data = "";
            res.on("data", (c) => data += c);
            res.on("end", () => {
              console.log("body:" + data);
              server.close();
            });
          });
        });
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("error_code:ERR_INVALID_CHAR");
    expect(stdout).toContain("body:ok");
    expect(exitCode).toBe(0);
  });

  test("allows valid non-link headers in early hints", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require("node:http");
        const server = http.createServer((req, res) => {
          try {
            res.writeEarlyHints({
              link: "</style.css>; rel=preload",
              "x-custom": "valid-value",
              "x-another": "also-valid",
            });
            console.log("OK: no error");
            res.writeHead(200);
            res.end("ok");
          } catch (e) {
            console.log("FAIL: " + e.message);
            process.exit(1);
          }
        });
        server.listen(0, () => {
          http.get({ port: server.address().port }, (res) => {
            let data = "";
            res.on("data", (c) => data += c);
            res.on("end", () => {
              console.log("body:" + data);
              server.close();
            });
          });
        });
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("OK: no error");
    expect(stdout).toContain("body:ok");
    expect(exitCode).toBe(0);
  });
});
