import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("request.headersDistinct returns object mapping headers to arrays of values", async () => {
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response("ok");
    },
  });

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
  expect(exitCode).toBe(0);
});
