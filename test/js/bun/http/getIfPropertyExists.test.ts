import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import * as RequestOptions from "./bun-request-fixture.js";
import * as ServerOptions from "./bun-serve-exports-fixture.js";

describe("getIfPropertyExists", () => {
  test("Bun.serve()", async () => {
    expect(() => Bun.serve(ServerOptions).stop(true)).not.toThrow();
  });

  test("new Request()", async () => {
    expect(await new Request("https://example.com/", RequestOptions).json()).toEqual({
      hello: "world",
    });
  });

  test("calls proxy getters", async () => {
    expect(
      await new Request(
        "https://example.com/",
        new Proxy(
          {},
          {
            get: (target, prop) => {
              if (prop === "body") {
                return JSON.stringify({ hello: "world" });
              } else if (prop === "method") {
                return "POST";
              }
            },
          },
        ),
      ).json(),
    ).toEqual({
      hello: "world",
    });
  });

  // NodeHTTPServer__writeHead's slow-path object branch enumerates own property
  // names and reads each one back. A getter that deletes a later-enumerated key
  // must not crash the header read.
  test("node:http native writeHead: getter deleting a later-enumerated header does not crash", async () => {
    const src = `
      const http = require("node:http");
      const server = http.createServer((req, res) => {
        const kHandle = Object.getOwnPropertySymbols(res).find(s => s.description === "handle");
        const handle = res[kHandle];
        const headers = {
          get "x-a"() { delete headers["x-b"]; return "a"; },
          "x-b": "b",
        };
        handle.writeHead(200, null, headers, 0, 0);
        handle.end("ok", "utf8", undefined, false);
      });
      server.listen(0, async () => {
        const { port } = server.address();
        const r = await fetch("http://127.0.0.1:" + port + "/");
        console.log(JSON.stringify({ status: r.status, xa: r.headers.get("x-a"), xb: r.headers.get("x-b") }));
        server.close();
      });
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({ status: 200, xa: "a", xb: null });
    expect(exitCode).toBe(0);
  });
});
