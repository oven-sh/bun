import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// An HTML route served without the DevServer bundles on its first request. The
// plugin load and the build finish on later event-loop turns and call back into
// the server through the route's raw back-pointer, while the clients waiting on
// the build only count as connections. Once they disconnected, nothing kept the
// server alive: stop(true) settled, the wrapper became collectable, the server
// was freed, and the build's completion then used it (heap-use-after-free in
// Route::on_complete or Route::on_plugins_resolved under ASAN). A building route
// now holds a pending request on the server, so stop() cannot settle before the
// build has finished and the server is still there when it does.
//
// The fixture parks the route inside the plugin (argv[2] picks where), drops
// the only client, calls stop(true), drops the server, and reports whether
// stop() settled while the route was still parked.
const fixture = {
  "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
  "index.html": `<!DOCTYPE html><html><head></head><body><script type="module" src="./entry.ts"></script></body></html>`,
  "entry.ts": `console.log("entry");`,
  "plugin.ts": /* ts */ `
    const { __mode: mode, __parked: parked, __release: release } = globalThis as any;
    export default {
      name: "park-the-route",
      async setup(build: any) {
        if (mode.startsWith("plugin setup")) {
          parked();
          await release;
          if (mode === "plugin setup rejection") throw new Error("plugin setup rejected on purpose");
        }
        build.onLoad({ filter: /entry\\.ts$/ }, async () => {
          if (mode === "build") {
            parked();
            await release;
          }
          return { loader: "ts", contents: "console.log('built')" };
        });
      },
    };
  `,
  "stack-words.ts": /* ts */ `
    // Where on the live native stack (or in a saved register) is this address? Prints each such word with the words around it that
    // point into the executable's image, as offsets from the image base, so that they can be looked up in the build's symbols.
    import { dlopen, ptr, toArrayBuffer } from "bun:ffi";

    function threadState(): { sp: bigint; high: bigint; image: [bigint, bigint]; registers: Record<string, bigint> } {
      if (process.platform === "win32") {
        const { symbols } = dlopen("kernel32.dll", {
          GetCurrentThreadStackLimits: { args: ["ptr", "ptr"], returns: "void" },
          RtlCaptureContext: { args: ["ptr"], returns: "void" },
          GetModuleHandleW: { args: ["ptr"], returns: "ptr" },
        });
        const low = new BigUint64Array(1), high = new BigUint64Array(1);
        symbols.GetCurrentThreadStackLimits(low, high);
        // CONTEXT is 1232 bytes and must be 16-byte aligned.
        const storage = new Uint8Array(1232 + 16);
        const skip = (16 - (ptr(storage) % 16)) % 16;
        symbols.RtlCaptureContext((ptr(storage) + skip) as any);
        const context = new BigUint64Array(storage.slice(skip, skip + 1232).buffer);
        const names = ["rax", "rcx", "rdx", "rbx", "rsp", "rbp", "rsi", "rdi", "r8", "r9", "r10", "r11", "r12", "r13", "r14", "r15"];
        const registers = Object.fromEntries(names.map((name, i) => [name, context[0x78 / 8 + i]]));
        const base = BigInt(symbols.GetModuleHandleW(null)!);
        const header = new DataView(toArrayBuffer(Number(base) as any, 0, 4096));
        const size = header.getUint32(header.getUint32(0x3c, true) + 0x18 + 0x38, true);
        return { sp: registers.rsp, high: high[0], image: [base, base + BigInt(size)], registers };
      }
      const { symbols } = dlopen("libc.so.6", { getcontext: { args: ["ptr"], returns: "i32" } });
      const context = new BigUint64Array(128);
      symbols.getcontext(context);
      const names = ["r8", "r9", "r10", "r11", "r12", "r13", "r14", "r15", "rdi", "rsi", "rbp", "rbx", "rdx", "rax", "rcx", "rsp"];
      const registers = Object.fromEntries(names.map((name, i) => [name, context[40 / 8 + i]]));
      const maps = require("node:fs").readFileSync("/proc/self/maps", "utf8").split("\\n");
      const range = (line: string) => line.split(" ")[0].split("-").map((hex: string) => BigInt("0x" + hex));
      const exe = maps.filter((line: string) => line.endsWith(process.execPath)).map(range);
      return { sp: registers.rsp, high: range(maps.find((line: string) => line.endsWith("[stack]"))!)[1], image: [exe[0][0], exe.at(-1)![1]], registers };
    }

    export function stackWords(address: bigint): string {
      try {
        const { sp, high, image, registers } = threadState();
        // A copy, taken at once: this function's own frames are in the lowest part of the range.
        const words = new BigUint64Array(toArrayBuffer(Number(sp) as any, 0, Number(high - sp))).slice();
        const hex = (n: bigint | number) => "0x" + n.toString(16);
        const inImage = (word: bigint) => word >= image[0] && word < image[1];
        const found: string[] = [];
        for (const [name, value] of Object.entries(registers)) if (value === address) found.push("register " + name);
        for (let i = 0; i < words.length; i++) {
          if (words[i] !== address) continue;
          const near: string[] = [];
          for (let j = Math.max(0, i - 96); j < Math.min(words.length, i + 384); j++)
            if (inImage(words[j])) near.push((j < i ? "-" : "+") + hex(Math.abs(j - i) * 8) + ":" + hex(words[j] - image[0]));
          found.push("word at sp+" + hex(i * 8) + " of " + hex(words.length * 8) + ", image words near it (distance:offset) " + near.join(" "));
        }
        return found.length ? found.join(" | ") : "no word of the live stack (" + hex(words.length * 8) + " bytes) and no saved register";
      } catch (error) {
        return "the stack could not be read: " + error;
      }
    }
  `,
  "run.ts": /* ts */ `
    import { generateHeapSnapshotForDebugging, jscDescribe } from "bun:jsc";
    import { stackWords } from "./stack-words.ts";
    import { heapFromTimer } from ${JSON.stringify(join(import.meta.dir, "..", "module-graph", "module-graph-lifetimes.ts"))};
    import html from "./index.html";

    // Read by plugin.ts, which Bun.serve loads into this same global on the
    // first request.
    const parked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    Object.assign(globalThis, { __mode: process.argv[2], __parked: parked.resolve, __release: release.promise });

    let collected = false;
    let serverAddress = 0n;
    const registry = new FinalizationRegistry(() => void (collected = true));
    const turn = () => new Promise<void>(r => setTimeout(r, 0));
    async function collectServer() {
      for (let i = 0; i < 50 && !collected; i++) {
        Bun.gc(true);
        await turn();
      }
      return collected;
    }

    // What the heap says about the server's cell, and whether more time frees it.
    function cellInHeap() {
      const { nodes, edges, roots, nodeClassNames, edgeTypes, edgeNames, labels } = generateHeapSnapshotForDebugging() as any;
      const className = new Map<number, string>();
      let id: number | undefined;
      for (let i = 0; i < nodes.length; i += 7) {
        className.set(nodes[i], nodeClassNames[nodes[i + 2]]);
        if (BigInt(nodes[i + 5]) === serverAddress) id = nodes[i];
      }
      if (id === undefined) return "its cell is not in the heap";
      const incoming: string[] = [];
      for (let i = 0; i < edges.length; i += 4)
        if (edges[i + 1] === id) {
          const type = edgeTypes[edges[i + 2]];
          const name = type === "Property" || type === "Variable" ? edgeNames[edges[i + 3]] : edges[i + 3];
          incoming.push(className.get(edges[i]) + " " + type + ":" + name);
        }
      const reasons: string[] = [];
      for (let i = 0; i < roots.length; i += 3) if (roots[i] === id) reasons.push(String(labels[roots[i + 1]] ?? roots[i + 1]));
      return "its cell is in the heap as " + className.get(id) + ", incoming edges [" + incoming + "], root entries [" + reasons + "]";
    }
    async function survivor() {
      await turn();
      const stack = stackWords(serverAddress);
      const path = (await heapFromTimer()).pathTo(serverAddress) ?? "nothing that a root reaches";
      const cell = await new Promise<string>(resolve => setTimeout(() => resolve(cellInHeap()), 0));
      const start = performance.now();
      let rounds = 0;
      for (; !collected && performance.now() - start < 3000; rounds++) {
        Bun.gc(true);
        await turn();
      }
      const later = (collected ? "collected" : "not collected") + " after " + rounds + " more rounds, " + Math.round(performance.now() - start) + " ms";
      await turn();
      return "held by " + path + "; " + cell + "; " + later + "; STACK WHILE IT SURVIVES: " + stack + "; STACK AFTERWARDS: " + stackWords(serverAddress);
    }

    // Its own frame, so that nothing on the stack still refers to the server
    // once it returns.
    async function stopWhileParked() {
      const server = Bun.serve({
        port: 0,
        development: false,
        routes: { "/": html },
        fetch: () => new Response("fallback"),
      });
      registry.register(server, "server");
      serverAddress = BigInt(/0x[0-9a-fA-F]+/.exec(jscDescribe(server))![0]);
      const controller = new AbortController();
      const request = fetch(server.url, { signal: controller.signal }).then(
        response => "status " + response.status,
        error => error.name,
      );
      await parked.promise;
      const pendingRequestsWhileParked = server.pendingRequests;
      controller.abort();
      return { fetch: await request, pendingRequestsWhileParked, stopped: server.stop(true) };
    }

    const { fetch: fetchResult, pendingRequestsWhileParked, stopped } = await stopWhileParked();
    let settled = false;
    stopped.then(() => void (settled = true));
    for (let i = 0; i < 10; i++) await turn();
    const stopBeforeRelease = settled ? "settled" : "pending";
    if (settled) {
      // Nothing holds the server for the parked route: let it be freed before
      // the route resumes, which is the use-after-free.
      await collectServer();
      await turn();
    }

    release.resolve();
    await stopped;
    console.log(
      JSON.stringify({
        fetch: fetchResult,
        pendingRequestsWhileParked,
        stopBeforeRelease,
        // A server that survives is reported with what holds it.
        collectedAfterwards: (await collectServer()) || (await survivor()),
      }),
    );
  `,
};

test.concurrent.each(["build", "plugin setup", "plugin setup rejection"])(
  "a server whose HTML route is parked in its %s outlives stop(true) until the route is done",
  async mode => {
    using dir = tempDir("serve-html-build-holds-server", fixture);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run.ts", mode],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // A crash (the ASAN report) replaces the fixture's report in the assertion.
    expect(stdout.trim() === "" ? stderr : JSON.parse(stdout)).toEqual({
      fetch: "AbortError",
      pendingRequestsWhileParked: 1,
      stopBeforeRelease: "pending",
      collectedAfterwards: true,
    });
    if (mode === "plugin setup rejection") {
      expect(stderr).toContain("plugin setup rejected on purpose");
    } else {
      expect(stderr).toBe("");
    }
    expect(exitCode).toBe(0);
  },
  // Passes in about a second; the ceiling is for the failure path, where ASAN
  // symbolizes the report against the debug binary before the child exits.
  30_000,
);

test("a request that waits for its HTML route's build isn't closed at idleTimeout", async () => {
  using dir = tempDir("serve-html-build-idle-timeout", {
    ...fixture,
    "run.ts": /* ts */ `
      import { sweepSocketTimers } from "bun:internal-for-testing";
      import html from "./index.html";

      const parked = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      Object.assign(globalThis, { __mode: "build", __parked: parked.resolve, __release: release.promise });

      using server = Bun.serve({
        port: 0,
        development: false,
        idleTimeout: 1,
        routes: { "/": html },
        fetch: () => new Response("fallback"),
      });
      const request = fetch(server.url).then(
        response => "status " + response.status,
        error => error.code,
      );
      await parked.promise;
      await new Promise(setImmediate);
      sweepSocketTimers(4);
      release.resolve();
      console.log(await request);
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: "status 200", stderr: "" });
  expect(exitCode).toBe(0);
}, 30_000);
