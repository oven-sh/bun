import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { totalmem } from "node:os";

// A Set-Cookie string is built in a WTF::StringBuilder, whose limit is 2^31-1
// characters. Serializing a cookie past that limit must throw a catchable error
// instead of aborting the process. The name below leaves 29 characters of room
// and the ten quotes in the value percent-encode to 30, so the append that
// passes the limit is the one inside the value encoder. The child needs ~4.3 GB
// (a 2 GB name plus a 2 GB builder), and validating the name takes about a
// minute in debug builds, so both entry points share one child and one cookie.
describe.skipIf(totalmem() < 10 * 1024 ** 3)("serializing a cookie past the maximum string length", () => {
  test("Bun.Cookie#toString() and Bun.CookieMap#toSetCookieHeaders() throw instead of aborting", async () => {
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
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "toString threw RangeError Out of memory\ntoSetCookieHeaders threw RangeError Out of memory\n",
      stderr: "",
      exitCode: 0,
    });
  }, 180_000);
});
