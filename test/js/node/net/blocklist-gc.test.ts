import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { BlockList, isIPv6 } from "node:net";
import path from "node:path";

// Node's documented round-trip API (v22+): toJSON returns the rules array and
// JSON.stringify(blockList) emits it; fromJSON rebuilds rules from that array
// (or its JSON string form).
describe("net.BlockList JSON round-trip", () => {
  it("exposes toJSON and fromJSON on the prototype", () => {
    expect(Object.getOwnPropertyNames(BlockList.prototype).sort()).toEqual([
      "addAddress",
      "addRange",
      "addSubnet",
      "check",
      "constructor",
      "fromJSON",
      "rules",
      "toJSON",
    ]);
    expect(typeof BlockList.prototype.toJSON).toBe("function");
    expect(typeof BlockList.prototype.fromJSON).toBe("function");
  });

  it("JSON.stringify of an empty BlockList is an empty array", () => {
    expect(JSON.stringify(new BlockList())).toBe("[]");
  });

  it("toJSON returns the rules array", () => {
    const blockList = new BlockList();
    blockList.addAddress("1.2.3.4");
    expect(blockList.toJSON()).toEqual(["Address: IPv4 1.2.3.4"]);
    expect(JSON.stringify(blockList)).toBe(JSON.stringify(blockList.rules));
  });

  it("round-trips every rule kind through toJSON/fromJSON", () => {
    const blockList = new BlockList();
    blockList.addAddress("1.2.3.4");
    blockList.addAddress("abcd::1", "ipv6");
    blockList.addRange("10.0.0.1", "10.0.0.10");
    blockList.addSubnet("192.168.0.0", 16);
    blockList.addSubnet("2001:db8::", 64, "ipv6");

    const restored = new BlockList();
    restored.fromJSON(blockList.toJSON());

    for (const ip of ["1.2.3.4", "abcd::1", "10.0.0.5", "192.168.1.1"]) {
      expect(restored.check(ip, isIPv6(ip) ? "ipv6" : "ipv4")).toBe(true);
    }
    expect(restored.check("2001:db8::1", "ipv6")).toBe(true);
    expect(restored.check("11.0.0.1")).toBe(false);
    // Same set of rules, regardless of ordering.
    expect(new Set(restored.toJSON())).toEqual(new Set(blockList.toJSON()));
  });

  it("fromJSON accepts the JSON string form", () => {
    const blockList = new BlockList();
    blockList.addAddress("1.2.3.4");
    const restored = new BlockList();
    restored.fromJSON(JSON.stringify(blockList.toJSON()));
    expect(restored.check("1.2.3.4")).toBe(true);
  });

  it("fromJSON silently ignores malformed rule entries", () => {
    const blockList = new BlockList();
    blockList.fromJSON(["nonsense", "Address: 1.2.3.4", "Address: IPv4 bad.addr"]);
    expect(blockList.toJSON()).toEqual([]);
  });

  it("fromJSON rejects non-string / non-string[] data with ERR_INVALID_ARG_TYPE", () => {
    const bad = [5, null, {}, [5], ["ok", 5]];
    for (const data of bad) {
      const blockList = new BlockList();
      expect(() => blockList.fromJSON(data as any)).toThrowWithCode(TypeError, "ERR_INVALID_ARG_TYPE");
    }
  });

  // toJSON is defined on the native prototype, not patched in node:net, so a
  // structured-clone wrapper created in a realm that never imported net still
  // has it (worker fan-out via postMessage).
  it("toJSON is available on a clone in a realm that never imported net", async () => {
    using dir = tempDir("blocklist-xrealm", {
      "worker.js": `
        globalThis.onmessage = e => {
          const bl = e.data;
          postMessage({
            hasToJSON: typeof bl.toJSON === "function",
            json: JSON.stringify(bl),
            check: bl.check("1.2.3.4"),
          });
        };
      `,
    });

    const worker = new Worker(path.join(String(dir), "worker.js"));
    try {
      const bl = new BlockList();
      bl.addAddress("1.2.3.4");
      const { promise, resolve, reject } = Promise.withResolvers<any>();
      worker.onmessage = e => resolve(e.data);
      worker.onerror = reject;
      worker.postMessage(bl);
      const result = await promise;
      expect(result.hasToJSON).toBe(true);
      expect(result.check).toBe(true);
      expect(JSON.parse(result.json)).toEqual(["Address: IPv4 1.2.3.4"]);
    } finally {
      worker.terminate();
    }
  });
});

// BlockList structured-clone serialize writes the native pointer and takes a
// single ref. When the same SerializedScriptValue is deserialized more than
// once (BroadcastChannel fans one message out to every subscriber), each
// deserialize created a JS wrapper whose finalizer derefs, so wrappers > refs
// and the backing was freed while a live wrapper still pointed at it. The
// next GC's visitChildren -> estimatedSize then read freed memory, hitting
// ASAN use-after-poison or SIGFPE (ref_count divisor read back as 0).
test("BlockList survives GC after BroadcastChannel fan-out clone", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { BlockList } = require("node:net");

        const sender = new BroadcastChannel("blocklist-gc");
        const recvA = new BroadcastChannel("blocklist-gc");
        const recvB = new BroadcastChannel("blocklist-gc");

        let bl = new BlockList();
        bl.addAddress("127.0.0.1");

        const received = [];
        const { promise, resolve } = Promise.withResolvers();
        const onmessage = e => {
          received.push(e.data);
          if (received.length === 2) resolve();
        };
        recvA.onmessage = onmessage;
        recvB.onmessage = onmessage;
        sender.postMessage(bl);
        await promise;

        // Keep one clone reachable, drop the original and the other clone so
        // their finalizers run and deref the shared backing.
        let kept = received[1];
        bl = null;
        received.length = 0;
        Bun.gc(true);
        Bun.gc(true);

        // Must not be a dangling pointer: visitChildren/estimatedSize runs here.
        Bun.gc(true);
        if (kept.rules.length !== 1) throw new Error("clone lost its rules");

        sender.close();
        recvA.close();
        recvB.close();
        console.log("ok");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exited] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const cleanedStderr = stderr
    .split("\n")
    .filter(line => line && !line.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  expect(cleanedStderr).toBe("");
  expect(stdout.trim()).toBe("ok");
  expect(exited).toBe(0);
});
