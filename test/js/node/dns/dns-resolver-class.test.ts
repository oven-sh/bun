// node-dns.test.js resolves public hostnames. These tests need no network.
import { describe, expect, test } from "bun:test";
import { runWithError } from "harness";
import dgram from "node:dgram";
import dns from "node:dns";
import { once } from "node:events";

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

/** A UDP socket that never answers: a query sent to it stays pending until `cancel()`. */
async function listenWithoutAnswering() {
  const socket = dgram.createSocket("udp4");
  socket.bind(0, "127.0.0.1");
  await once(socket, "listening");
  return { socket, servers: ["127.0.0.1:" + socket.address().port] };
}

/** Starts a query of `resolver` that settles with the code of its error. */
const pendingQueries: [string, () => { resolver: any; query: () => Promise<string | undefined> }][] = [
  [
    "dns.Resolver",
    () => {
      const resolver = new dns.Resolver();
      const query = () =>
        new Promise<string | undefined>(resolve =>
          resolver.resolve4("pending.example.test", err => resolve(err?.code)),
        );
      return { resolver, query };
    },
  ],
  [
    "dns.promises.Resolver",
    () => {
      const resolver = new dns.promises.Resolver();
      const query = () =>
        resolver.resolve4("pending.example.test").then(
          () => undefined,
          err => err.code,
        );
      return { resolver, query };
    },
  ],
];

// https://github.com/nodejs/node/pull/65021
describe("setServers port range", () => {
  const badPort = {
    name: "RangeError",
    code: "ERR_SOCKET_BAD_PORT",
    message: expect.stringMatching(/^Port should be >= 0 and < 65536\. Received /),
  };

  type Target = { setServers(servers: readonly unknown[]): void; getServers(): string[] };
  describe.each<[string, () => Target]>([
    ["dns", () => dns as Target],
    ["dns.promises", () => dns.promises as Target],
    ["dns.Resolver", () => new dns.Resolver() as Target],
    ["dns.promises.Resolver", () => new dns.promises.Resolver() as Target],
    // With a receiver that is no Resolver, the method acts on the default resolver.
    [
      "dns.Resolver.prototype.setServers.call(undefined)",
      () => ({
        setServers: servers => dns.Resolver.prototype.setServers.call(undefined, servers as string[]),
        getServers: () => dns.getServers(),
      }),
    ],
  ])("%s", (_name, make) => {
    // `dns` and `dns.promises` set the servers of the default resolver, which the whole process shares: put them back.
    function withResolver(fn: (resolver: Target, original: string[]) => void) {
      const resolver = make();
      const original = resolver.getServers();
      try {
        fn(resolver, original);
      } finally {
        resolver.setServers(original);
      }
    }

    // Before the check, 65536 and 2**32 + 53 were the default port, and 99999 was 34463.
    test.each([
      ["127.0.0.1:65536", "127.0.0.1:65536"],
      ["127.0.0.1:99999", "127.0.0.1:99999"],
      ["127.0.0.1:2**32+53", `127.0.0.1:${2 ** 32 + 53}`],
      ["127.0.0.1:2**64", "127.0.0.1:18446744073709551616"],
      ["127.0.0.1:<400 digits>", `127.0.0.1:${Buffer.alloc(400, "9")}`],
      ["[::1]:65536", "[::1]:65536"],
      ["[::1]:99999", "[::1]:99999"],
      ["[::1]:2**32+53", `[::1]:${2 ** 32 + 53}`],
      ["[::1]:<400 digits>", `[::1]:${Buffer.alloc(400, "9")}`],
      ["[fe80::1%lo]:99999", "[fe80::1%lo]:99999"],
    ])("%s throws ERR_SOCKET_BAD_PORT and leaves the servers as they were", (_label, server) => {
      withResolver((resolver, original) => {
        expect(runWithError(() => resolver.setServers([server]))).toMatchObject(badPort);
        expect(runWithError(() => resolver.setServers(["192.0.2.2", server]))).toMatchObject(badPort);
        expect(resolver.getServers()).toEqual(original);
      });
    });

    test("accepts the ports 0 to 65535", () => {
      withResolver(resolver => {
        resolver.setServers([
          "127.0.0.1:65535",
          "[::1]:65535",
          "127.0.0.2:0",
          "[::2]:0",
          "127.0.0.3:00053",
          "127.0.0.4:000000000000099",
        ]);
        expect(resolver.getServers()).toEqual([
          "127.0.0.1:65535",
          "[::1]:65535",
          "127.0.0.2",
          "::2",
          "127.0.0.3",
          "127.0.0.4:99",
        ]);
      });
    });

    test("checks the servers in order, and the address of a server before its port", () => {
      withResolver((resolver, original) => {
        const invalidAddress = (server: string) => ({
          name: "TypeError",
          code: "ERR_INVALID_IP_ADDRESS",
          message: `Invalid IP address: ${server}`,
        });
        expect(runWithError(() => resolver.setServers(["1.2.3.4:65536", "nope"]))).toMatchObject(badPort);
        expect(runWithError(() => resolver.setServers(["1.2.3.4:65536", 5]))).toMatchObject(badPort);
        expect(runWithError(() => resolver.setServers(["nope", "1.2.3.4:65536"]))).toMatchObject(
          invalidAddress("nope"),
        );
        expect(runWithError(() => resolver.setServers(["nope:65536"]))).toMatchObject(invalidAddress("nope:65536"));
        expect(runWithError(() => resolver.setServers(["[nope]:65536"]))).toMatchObject(invalidAddress("[nope]:65536"));
        expect(resolver.getServers()).toEqual(original);
      });
    });
  });

  test.concurrent.each(pendingQueries)("%s with a pending query reports the port first", async (_name, make) => {
    const { socket, servers } = await listenWithoutAnswering();
    const { resolver, query } = make();
    try {
      resolver.setServers(servers);
      const received = once(socket, "message");
      const settled = query();
      await received;
      expect(runWithError(() => resolver.setServers(["1.2.3.4:65536"]))).toMatchObject(badPort);
      expect(runWithError(() => resolver.setServers(["1.2.3.4"]))).toMatchObject({
        code: "ERR_DNS_SET_SERVERS_FAILED",
      });
      expect(resolver.getServers()).toEqual(servers);
      resolver.cancel();
      expect(await settled).toBe("ECANCELLED");
      expect(runWithError(() => resolver.setServers(["1.2.3.4:65536"]))).toMatchObject(badPort);
    } finally {
      resolver.cancel();
      socket.close();
    }
  });
});
