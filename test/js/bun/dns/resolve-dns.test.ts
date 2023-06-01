import { dns } from "bun";
import { describe, expect, it, test } from "bun:test";
import { withoutAggressiveGC } from "harness";

describe("dns.lookup", () => {
  const backends = [process.platform === "darwin" ? "system" : undefined, "libc", "c-ares"].filter(x => !!x) as (
    | "system"
    | "libc"
    | "c-ares"
  )[];
  for (let backend of backends) {
    it(backend + " parallell x 10", async () => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(dns.lookup("localhost", { backend }));
      }
      const results = (await Promise.all(promises)).flat();
      withoutAggressiveGC(() => {
        for (let { family, address } of results) {
          if (family === 4) {
            expect(address).toBe("127.0.0.1");
          } else if (family === 6) {
            expect(address).toBe("::1");
          } else {
            throw new Error("Unknown family");
          }
        }
      });
    });

    it(backend + " remote", async () => {
      const [first, second] = await dns.lookup("google.com", { backend });
      console.log(first, second);
    });
    it(backend + " local", async () => {
      const [first, second] = await dns.lookup("localhost", { backend });
      console.log(first, second);
    });

    it(backend + " failing domain throws an error without taking a very long time", async () => {
      try {
        await dns.lookup("yololololololo1234567.com", { backend });
        throw 42;
      } catch (e: any) {
        expect(typeof e).not.toBe("number");
        expect(e.code).toBe("DNS_ENOTFOUND");
      }
    });
  }
});
