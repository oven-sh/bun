// node-dns.test.js resolves public hostnames. These tests need no network.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, runWithError } from "harness";
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

// A socket prints a link-local peer with its zone, and a program hands that text to these. Node.js answers
// ENOTFOUND for it too.
test("reverse() and lookupService() ask for the name of an address with a zone as for the address alone", async () => {
  const script = `
    const dgram = require("node:dgram");
    const dns = require("node:dns");

    // A name server that has no name for any address.
    const asked = new Set();
    const server = dgram.createSocket("udp4");
    server.on("message", (query, { port, address }) => {
      let end = 12;
      const labels = [];
      while (query[end] !== 0) {
        labels.push(query.toString("latin1", end + 1, end + 1 + query[end]));
        end += 1 + query[end];
      }
      asked.add(labels.join("."));
      const answer = Buffer.from(query.subarray(0, end + 5));
      answer[2] |= 0x80; // QR
      answer[3] = 3; // NXDOMAIN
      answer.fill(0, 6, 12); // no records
      server.send(answer, port, address);
    });
    server.bind(0, "127.0.0.1", async () => {
      dns.setServers(["127.0.0.1:" + server.address().port]);
      const code = ask => new Promise(resolve => ask(error => resolve(error ? error.code : "a name")));
      const answers = {};
      for (const address of ["fe80::1234", "fe80::1234%eth0"]) {
        answers[address] = [
          await code(callback => dns.reverse(address, callback)),
          await code(callback => dns.lookupService(address, 80, callback)),
        ];
      }
      console.log(JSON.stringify({ answers, asked: [...asked] }));
      server.close();
    });
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify({
      answers: { "fe80::1234": ["ENOTFOUND", "ENOTFOUND"], "fe80::1234%eth0": ["ENOTFOUND", "ENOTFOUND"] },
      asked: ["4.3.2.1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.e.f.ip6.arpa"],
    }),
    stderr: "",
    exitCode: 0,
  });
});
