import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("request.headersDistinct returns object mapping headers to arrays of values", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const http = require("node:http");
      const server = http.createServer((req, res) => {
        const hd = req.headersDistinct;
        const td = req.trailersDistinct;

        // headersDistinct should be an object (not undefined)
        if (typeof hd !== "object" || hd === null) {
          res.writeHead(500);
          res.end("headersDistinct is not an object: " + typeof hd);
          return;
        }

        // trailersDistinct should be an object (not undefined)
        if (typeof td !== "object" || td === null) {
          res.writeHead(500);
          res.end("trailersDistinct is not an object: " + typeof td);
          return;
        }

        // Each value should be an array
        for (const [key, val] of Object.entries(hd)) {
          if (!Array.isArray(val)) {
            res.writeHead(500);
            res.end("value for " + key + " is not an array");
            return;
          }
        }

        // host header should exist and be an array
        const hostArr = hd["host"];
        if (!Array.isArray(hostArr) || hostArr.length !== 1) {
          res.writeHead(500);
          res.end("host header incorrect: " + JSON.stringify(hostArr));
          return;
        }

        res.writeHead(200);
        res.end("ok");
      });

      server.listen(0, () => {
        const port = server.address().port;
        http.get("http://localhost:" + port, { headers: { "x-custom": "test-value" } }, (res) => {
          let data = "";
          res.on("data", (chunk) => data += chunk);
          res.on("end", () => {
            console.log(data);
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

  expect(stdout.trim()).toBe("ok");
  expect(stderr.trim()).toBe("");
  expect(exitCode).toBe(0);
});

test("response.headersDistinct returns object mapping headers to arrays of values", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const http = require("node:http");
      const server = http.createServer((req, res) => {
        res.setHeader("x-multi", ["val1", "val2"]);
        res.writeHead(200);
        res.end("hello");
      });

      server.listen(0, () => {
        const port = server.address().port;
        http.get("http://localhost:" + port, (res) => {
          const hd = res.headersDistinct;
          const td = res.trailersDistinct;

          if (typeof hd !== "object" || hd === null) {
            console.log("FAIL: headersDistinct is not an object: " + typeof hd);
            server.close();
            return;
          }

          if (typeof td !== "object" || td === null) {
            console.log("FAIL: trailersDistinct is not an object: " + typeof td);
            server.close();
            return;
          }

          // Each value should be an array
          for (const [key, val] of Object.entries(hd)) {
            if (!Array.isArray(val)) {
              console.log("FAIL: value for " + key + " is not an array");
              server.close();
              return;
            }
          }

          // x-multi header should be present as an array containing both values
          // (either as separate elements or comma-joined in a single element)
          const xMulti = hd["x-multi"];
          const hasVal1 = Array.isArray(xMulti) && xMulti.some(v => v.includes("val1"));
          const hasVal2 = Array.isArray(xMulti) && xMulti.some(v => v.includes("val2"));
          if (!hasVal1 || !hasVal2) {
            console.log("FAIL: x-multi header incorrect: " + JSON.stringify(xMulti));
            server.close();
            return;
          }

          console.log("ok");
          res.resume();
          res.on("end", () => server.close());
        });
      });
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("ok");
  expect(stderr.trim()).toBe("");
  expect(exitCode).toBe(0);
});

test("http2 request.headersDistinct returns object mapping headers to arrays of values", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const http2 = require("node:http2");
      const server = http2.createServer((req, res) => {
        const hd = req.headersDistinct;
        const td = req.trailersDistinct;

        if (typeof hd !== "object" || hd === null) {
          res.writeHead(500);
          res.end("headersDistinct is not an object: " + typeof hd);
          return;
        }

        if (typeof td !== "object" || td === null) {
          res.writeHead(500);
          res.end("trailersDistinct is not an object: " + typeof td);
          return;
        }

        for (const [key, val] of Object.entries(hd)) {
          if (!Array.isArray(val)) {
            res.writeHead(500);
            res.end("value for " + key + " is not an array");
            return;
          }
        }

        res.writeHead(200);
        res.end("ok");
      });

      server.listen(0, () => {
        const port = server.address().port;
        const client = http2.connect("http://localhost:" + port);
        const req = client.request({ ":path": "/", "x-custom": "test-value" });
        let data = "";
        req.on("data", (chunk) => data += chunk);
        req.on("end", () => {
          console.log(data);
          client.close();
          server.close();
        });
        req.end();
      });
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("ok");
  expect(stderr.trim()).toBe("");
  expect(exitCode).toBe(0);
});

test("http2 server verifies headersDistinct contains client-sent custom header", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const http2 = require("node:http2");
      const server = http2.createServer((req, res) => {
        const hd = req.headersDistinct;

        // Verify x-custom header is present as an array
        const xCustom = hd && hd["x-custom"];
        if (!Array.isArray(xCustom) || !xCustom.some(v => v.includes("test-value"))) {
          res.writeHead(500);
          res.end("FAIL: x-custom header incorrect: " + JSON.stringify(xCustom));
          return;
        }

        // Verify all values are arrays
        for (const [key, val] of Object.entries(hd)) {
          if (!Array.isArray(val)) {
            res.writeHead(500);
            res.end("FAIL: value for " + key + " is not an array");
            return;
          }
        }

        res.writeHead(200);
        res.end("ok");
      });

      server.listen(0, () => {
        const port = server.address().port;
        const client = http2.connect("http://localhost:" + port);
        const req = client.request({ ":path": "/", "x-custom": "test-value" });
        let data = "";
        req.on("data", (chunk) => data += chunk);
        req.on("end", () => {
          console.log(data);
          client.close();
          server.close();
        });
        req.end();
      });
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("ok");
  expect(stderr.trim()).toBe("");
  expect(exitCode).toBe(0);
});
