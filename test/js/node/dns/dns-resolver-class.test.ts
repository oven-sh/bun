// node-dns.test.js resolves public hostnames. These tests need no network.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, nodeExeAtLeast, runWithError, tempDir } from "harness";
import dgram from "node:dgram";
import dns from "node:dns";
import { once } from "node:events";
import path from "node:path";

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
    ["setLocalAddress", "ERR_INVALID_ARG_VALUE"],
    ["setServers", "ERR_INVALID_ARG_TYPE"],
  ])("_handle.%s() treats a missing argument as undefined", (method, code) => {
    const handle = new Resolver()._handle;
    const missing = runWithError(() => handle[method]());
    expect(missing).toMatchObject({ name: "TypeError", code });
    expect(missing).toEqual(runWithError(() => handle[method](undefined)));
  });
});

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
// Not every release line of Node.js reads again: 22 does not. This is the oldest one that was compared.
const node = nodeExeAtLeast("26.3.0");

// The shim below gives a process its own /etc. macOS and Windows do not read their servers from a file.
describe.skipIf(!isLinux || !cc)("a process with no descriptor left at the first use of its resolver", () => {
  // Answers an A query with 10.20.0.1, and any other with the name host.example.test.
  async function answeringServer() {
    const socket = dgram.createSocket("udp4");
    socket.on("message", (query, { port, address }) => {
      let end = 12;
      while (query[end] !== 0) end += query[end] + 1;
      end += 5;
      const type = query.subarray(end - 4, end - 2);
      const data = type[1] === 1 ? Buffer.from([10, 20, 0, 1]) : Buffer.from("\x04host\x07example\x04test\0");
      const header = Buffer.from([query[0], query[1], 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0]);
      const answer = Buffer.concat([Buffer.from([0xc0, 12]), type, Buffer.from([0, 1, 0, 0, 0, 60, 0, data.length])]);
      socket.send(Buffer.concat([header, query.subarray(12, end), answer, data]), port, address);
    });
    socket.bind(0, "127.0.0.1");
    await once(socket, "listening");
    return { address: `127.0.0.1:${socket.address().port}`, [Symbol.dispose]: () => socket.close() };
  }

  // Asks twice: with every descriptor taken, when the configuration cannot be read and no socket opened, and with them free.
  const script = (call: string, servers: string) => `
    import dns from "node:dns";
    import fs from "node:fs";
    const { promises } = dns;
    const held = [];
    try {
      for (;;) held.push(fs.openSync("/dev/null"));
    } catch {}
    const resolver = new promises.Resolver();
    const ask = () => ${call}.then(String, error => error.code);
    const first = [await ask(), ...${servers}];
    held.forEach(fd => fs.closeSync(fd));
    console.log(...first);
    console.log(await ask(), ...${servers});
  `;

  // Runs it with few descriptors, and with an fopen() that reads the files of /etc from ./etc.
  async function run(runtime: string, call: string, servers: string) {
    using answering = await answeringServer();
    using dir = tempDir("dns-no-descriptor", {
      "etc/resolv.conf": `nameserver ${answering.address}\n`,
      "query.mjs": script(call, servers),
      "shim.c": `
        #define _GNU_SOURCE
        #include <dlfcn.h>
        #include <string.h>
        void *fopen(const char *path, const char *mode) {
          void *(*next)(const char *, const char *) = dlsym(RTLD_NEXT, "fopen");
          return next(strncmp(path, "/etc/", 5) ? path : path + 1, mode);
        }
        void *fopen64(const char *path, const char *mode) { return fopen(path, mode); }
      `,
    });
    const shim = path.join(String(dir), "shim.so");
    await Bun.$`${cc} -shared -fPIC -o ${shim} ${path.join(String(dir), "shim.c")} -ldl`.env(bunEnv).quiet();
    await using proc = Bun.spawn({
      cmd: ["sh", "-c", `ulimit -n 128 && exec "$@"`, "sh", runtime, "query.mjs"],
      env: { ...bunEnv, LD_PRELOAD: [shim, bunEnv.LD_PRELOAD].filter(Boolean).join(":") },
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.replaceAll(answering.address, "the server"), stderr, exitCode };
  }

  const resolve4 = [`resolver.resolve4("a.example.test")`, "resolver.getServers()"] as const;
  const answered = { stdout: "ECONNREFUSED 127.0.0.1\n10.20.0.1 the server\n", stderr: "", exitCode: 0 };

  test.concurrent("resolve4() is answered once descriptors are free", async () => {
    expect(await run(bunExe(), ...resolve4)).toEqual(answered);
  });

  test.concurrent.skipIf(!node)("resolve4() is answered once descriptors are free, in Node.js", async () => {
    expect(await run(node!, ...resolve4)).toEqual(answered);
  });

  // Node.js does not read again after these: a refused reverse() ends as ENOTFOUND there, and the other two ask the system.
  test.concurrent.each([
    ["reverse()", `resolver.reverse("192.0.2.80")`, "resolver.getServers()", "ENOTFOUND", "host.example.test"],
    [
      "lookupService()",
      `promises.lookupService("192.0.2.80", 0).then(it => it.hostname)`,
      "dns.getServers()",
      "ENOTFOUND",
      "host.example.test",
    ],
    [
      "Bun.dns.lookup()",
      `Bun.dns.lookup("a.example.test", { family: 4 }).then(it => it[0].address)`,
      "dns.getServers()",
      "DNS_ECONNREFUSED",
      "10.20.0.1",
    ],
  ])("%s is answered once descriptors are free", async (_, call, servers, refusal, answer) => {
    expect(await run(bunExe(), call, servers)).toEqual({
      stdout: `${refusal} 127.0.0.1\n${answer} the server\n`,
      stderr: "",
      exitCode: 0,
    });
  });
});
