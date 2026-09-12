import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { totalmem } from "node:os";

// A Set-Cookie string is built in a WTF::StringBuilder, whose limit is 2^31-1
// characters. Serializing a cookie past that limit must throw a catchable error
// instead of aborting the process. The name below leaves 29 characters of room
// and the ten quotes in the value percent-encode to 30, so the append that
// passes the limit is the one inside the value encoder. The child needs ~4.3 GB
// (a 2 GB name plus a 2 GB builder), and validating the name takes about a
// minute in debug builds, so every entry point shares one child and one cookie.
describe.skipIf(totalmem() < 10 * 1024 ** 3)("serializing a cookie past the maximum string length", () => {
  test("throws from toString() and toSetCookieHeaders(), and Bun.serve reports it and still responds", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const cookie = new Bun.Cookie("a".repeat(2 ** 31 - 30), '"'.repeat(10));
          try {
            const header = cookie.toString();
            console.log("toString resolved", header.length);
          } catch (e) {
            console.log("toString threw", e.name, e.message);
          }

          const map = new Bun.CookieMap();
          map.set(cookie);
          try {
            const headers = map.toSetCookieHeaders();
            console.log("toSetCookieHeaders resolved", headers.length);
          } catch (e) {
            console.log("toSetCookieHeaders threw", e.name, e.message);
          }

          // The status line is written before the cookies, so the server cannot
          // turn this into an error response: it prints the error and sends the
          // response without the Set-Cookie header.
          using server = Bun.serve({
            port: 0,
            development: false,
            routes: {
              "/": req => {
                req.cookies.set(cookie);
                return new Response("hello");
              },
            },
          });
          const res = await fetch(server.url);
          console.log("serve", res.status, res.headers.get("set-cookie"), res.headers.get("content-type"), await res.text());
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe(
      "toString threw RangeError Out of memory\n" +
        "toSetCookieHeaders threw RangeError Out of memory\n" +
        "serve 200 null text/plain;charset=utf-8 hello\n",
    );
    expect(stderr).toContain("RangeError: Out of memory");
    expect(exitCode).toBe(0);
  }, 180_000);
});
