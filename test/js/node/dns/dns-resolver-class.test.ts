// node-dns.test.js resolves public hostnames. These tests need no network.
import { describe, expect, test } from "bun:test";
import { bunRun, runWithError } from "harness";
import dns from "node:dns";

describe.each([
  ["dns.Resolver", dns.Resolver],
  ["dns.promises.Resolver", dns.promises.Resolver],
])("%s", (_name, Resolver: any) => {
  test("an instance has Resolver.prototype", () => {
    const resolver = new Resolver();
    expect(Object.getPrototypeOf(resolver)).toBe(Resolver.prototype);
    expect(resolver.constructor).toBe(Resolver);
  });

  test("a subclass instance has the subclass prototype and its own servers", () => {
    class PinnedResolver extends Resolver {
      getServers() {
        return super.getServers().map((server: string) => `pinned ${server}`);
      }
    }

    const resolver = new (PinnedResolver as any)({ timeout: 1000, tries: 1 });
    expect(Object.getPrototypeOf(resolver)).toBe(PinnedResolver.prototype);
    expect(resolver).toBeInstanceOf(Resolver);

    resolver.setServers(["192.0.2.1"]);
    expect(resolver.getServers()).toEqual(["pinned 192.0.2.1"]);
    expect(dns.getServers()).not.toContain("192.0.2.1");
  });

  test("throws a TypeError when called without new", () => {
    expect(() => Resolver()).toThrow(TypeError);
  });

  test.each([
    ["resolve", "ERR_INVALID_ARG_TYPE"],
    ["resolveAny", "ERR_INVALID_ARG_TYPE"],
    ["reverse", "ERR_INVALID_ARG_TYPE"],
    ["setLocalAddress", "ERR_INVALID_IP_ADDRESS"],
    ["setServers", "ERR_INVALID_ARG_TYPE"],
  ])("_handle.%s() treats a missing argument as undefined", (method, code) => {
    const handle = new Resolver()._handle;
    const missing = runWithError(() => handle[method]());
    expect(missing).toMatchObject({ name: "TypeError", code });
    expect(missing).toEqual(runWithError(() => handle[method](undefined)));
  });
});

describe.concurrent("disposing the Bun.ModuleGraph that made a resolver while the resolver is in use", () => {
  const prelude = `
    const graph = new Bun.ModuleGraph();
    const resolver = graph.run(() => new (require("node:dns").promises.Resolver)());
  `;

  test("from valueOf() of an argument of setServers()", async () => {
    const src = `${prelude}
      const family = { valueOf() { graph.dispose(); return 4; } };
      console.log(resolver._handle.setServers([[family, "192.0.2.1", 53]]));
    `;
    expect(await bunRun(["-e", src])).toSpawn("undefined");
  });

  test("from the then getter of an answer", async () => {
    const src = `${prelude}
      const server = await Bun.udpSocket({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          data(socket, query, port, address) {
            let end = 12;
            while (query[end]) end += query[end] + 1;
            const header = [query[0], query[1], 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0];
            const record = [0xc0, 12, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 192, 0, 2, 1];
            socket.send(Buffer.from([...header, ...query.subarray(12, end + 5), ...record]), port, address);
          },
        },
      });
      resolver.setServers(["127.0.0.1:" + server.port]);
      const answer = resolver.resolve4("example.test");
      Object.defineProperty(Array.prototype, "then", {
        configurable: true,
        get() {
          delete Array.prototype.then;
          graph.dispose();
          console.log("disposed");
        },
      });
      console.log(JSON.stringify(await answer));
      server.close();
    `;
    expect(await bunRun(["-e", src])).toSpawn('disposed\n["192.0.2.1"]');
  });
});
