// Runs alone: its last tests disturb other processes that use the GPU of a macOS virtual machine.
import { describe, expect, test } from "bun:test";
import { bunExe, bunEnv as defaultEnv, isASAN, isDebug, isLinux, libcPathForDlopen, tempDir } from "harness";
import { hasAdapter, runWithDriverOfChrome } from "./driver";

runWithDriverOfChrome(import.meta.path);

// As in CI. With ASAN the process ends in exit(), which runs the destructors of a driver whose threads may be at work.
const bunEnv = isASAN ? { ...defaultEnv, BUN_DESTRUCT_VM_ON_EXIT: "1" } : defaultEnv;
// The timer and the finalizers would wake an event loop that has missed something.
const withoutGCTimer = { ...bunEnv, BUN_GC_TIMER_DISABLE: "1" };
const withoutGC = { ...withoutGCTimer, BUN_JSC_useGC: "0" };

const helpers = `
  import { readdirSync, readFileSync } from "node:fs";
  /** On Linux, the devices that have waited for the GPU and are not destroyed. */
  export const countWatchers = () => readdirSync("/proc/self/task").filter(thread => {
    try { return readFileSync(\`/proc/self/task/\${thread}/comm\`, "utf8") === "GPUQueue\\n"; } catch {}
  }).length;
  export const requestDevice = async () => (await navigator.gpu.requestAdapter()).requestDevice();
  export const slowModule = (device, seed, rounds = 10000) => device.createShaderModule({ code: \`
    @group(0) @binding(0) var<storage, read_write> out: array<u32, 64>;
    @compute @workgroup_size(64) fn main(@builtin(local_invocation_index) index: u32) {
      var x = index + \${seed};
      for (var i = 0; i < \${rounds}; i++) { x = x * 1664525 + 1013904223; }
      out[index] = x;
    }\` });
  export const compile = (device, seed) =>
    device.createComputePipelineAsync({ layout: "auto", compute: { module: slowModule(device, seed) } });
  /** Submits when it is called, and returns a buffer to map once the GPU is done. */
  export function prepare(device, workgroups = 100) {
    const pipeline = device.createComputePipeline({ layout: "auto", compute: { module: slowModule(device, 0) } });
    const resource = device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const result = device.createBuffer({ size: 256, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource }] }));
    pass.dispatchWorkgroups(workgroups);
    pass.end();
    encoder.copyBufferToBuffer(resource, result);
    const commands = encoder.finish();
    return () => (device.queue.submit([commands]), result);
  }
  export const keepBusy = (device, workgroups) => prepare(device, workgroups)();
  /** One of each thing that can be under way. */
  export function startEverything(device) {
    device.onuncapturederror = event => event.preventDefault();
    device.createBuffer({ size: 4, usage: 0 });
    globalThis.range = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_SRC, mappedAtCreation: true }).getMappedRange();
    device.pushErrorScope("validation");
    return [
      keepBusy(device).mapAsync(GPUMapMode.READ),
      device.queue.onSubmittedWorkDone(),
      compile(device, 1),
      compile(device, 2),
      slowModule(device, 3).getCompilationInfo(),
      device.popErrorScope(),
      navigator.gpu.requestAdapter(),
    ];
  }`;
const imports = `import { compile, countWatchers, keepBusy, prepare, requestDevice, slowModule, startEverything } from "./helpers.js";\n`;

async function run(files: Record<string, string>, args = ["index.js"], env = bunEnv) {
  using dir = tempDir("webgpu", {
    ...Object.fromEntries(Object.entries(files).map(([name, source]) => [name, imports + source])),
    "helpers.js": helpers,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: String(dir),
    env,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}
const printed = (stdout: string) => ({ stdout: stdout + "\n", stderr: "", exitCode: 0 });

/** Two files for `require()`, which runs a macro on the thread and in the realm of the program. */
const withMacro = (name: string, macro: string) => ({
  [`${name}.js`]: `
    import { macro } from "./${name}-macro.js" with { type: "macro" };
    console.log(macro());`,
  [`${name}-macro.js`]: `export const macro = ${macro};`,
});
// A debug build prints a line for each call of a macro.
const withoutMacroLog = (stdout: string) => stdout.replaceAll("[macro] call macro\n", "");

describe.concurrent("with or without a driver", () => {
  const noAdapter = `navigator.gpu.requestAdapter({ featureLevel: "none" })`;

  const countTurnsOfEventLoop = `async () => {
    let turns = 0;
    let immediate = setImmediate(function count() { turns++, (immediate = setImmediate(count)); });
    for (let i = 0; i < 20; i++) await ${noAdapter};
    clearImmediate(immediate);
    return turns >= 20;
  }`;

  test("the event loop turns before a promise settles", async () => {
    expect(await run({ "index.js": `console.log(await (${countTurnsOfEventLoop})());` })).toEqual(printed("true"));
  });

  test("the event loop of a macro turns before a promise settles", async () => {
    const files = { "index.js": `require("./inlined.js");`, ...withMacro("inlined", countTurnsOfEventLoop) };
    const { stdout, exitCode } = await run(files);
    expect(withoutMacroLog(stdout)).toBe("true\n");
    expect(exitCode).toBe(0);
  });

  test("promises settle after an unhandled error under --hot", async () => {
    const script = `
      setImmediate(() => { throw new Error("unhandled"); });
      setImmediate(async () => {
        for (let i = 0; i < 40; i++) await ${noAdapter}, await new Promise(setImmediate);
        console.log("done");
        process.exit(0);
      });`;
    const { stdout, stderr, exitCode } = await run({ "index.js": script }, ["--hot", "index.js"], withoutGC);
    expect(stderr).toContain("error: unhandled");
    expect({ stdout, exitCode }).toEqual({ stdout: "done\n", exitCode: 0 });
  });

  test("a worker ends before a promise settles", async () => {
    const files = {
      "index.js": `new Worker("./worker.js").addEventListener("close", () => console.log("closed"));`,
      // LeakSanitizer is told to ignore what the top level of a module allocates.
      "worker.js": `require("node:fs").stat(".", () => (${noAdapter}.then(console.log), process.exit(0)));`,
    };
    expect(await run(files)).toEqual(printed("closed"));
  });

  test.each([
    ["at once", `require("./inlined.js");`],
    [
      "from a task that is ahead in the queue",
      `new PerformanceObserver(() => require("./inlined.js")).observe({ type: "mark" });
       performance.mark("queues a task");`,
    ],
  ])("a macro waits for what the program started, %s", async (_, load) => {
    const files = {
      "index.js": `setImmediate(() => { globalThis.started = ${noAdapter}; ${load} });`,
      ...withMacro("inlined", `async () => String(await started)`),
    };
    const { stdout, exitCode } = await run(files, undefined, withoutGC);
    expect(withoutMacroLog(stdout)).toBe("null\n");
    expect(exitCode).toBe(0);
  });

  test.each([
    ["at the top level", `await rounds();`],
    ["in a callback", `setImmediate(rounds);`],
  ])("the program waits %s for what a macro started as it returned", async (_, start) => {
    const files = {
      "index.js": `
        // A timer of the garbage collector can end the first waits.
        async function rounds() {
          for (let i = 0; i < 8; i++) {
            delete require.cache[require.resolve("./inlined.js")];
            require("./inlined.js");
            console.log(await left);
            await new Promise(setImmediate);
          }
        }
        ${start}`,
      ...withMacro(
        "inlined",
        `() => new Promise(resolve => setImmediate(() => ((globalThis.left = ${noAdapter}), resolve("macro"))))`,
      ),
    };
    const { stdout, exitCode } = await run(files, undefined, withoutGC);
    expect(withoutMacroLog(stdout)).toBe(Array(8).fill("macro\nnull\n").join(""));
    expect(exitCode).toBe(0);
  });

  test("a macro waits while the program has yet to finish what another one left", async () => {
    const files = {
      "index.js": `
        new PerformanceObserver(() => require("./second.js")).observe({ type: "mark" });
        setImmediate(() => {
          performance.mark("queues a task");
          require("./first.js");
        });`,
      ...withMacro("first", `() => (${noAdapter}.then(() => console.log("left")), "first")`),
      ...withMacro("second", `async () => (await ${noAdapter}, "second")`),
    };
    const { stdout, exitCode } = await run(files);
    expect(withoutMacroLog(stdout).split("\n").sort()).toEqual(["", "first", "left", "second"]);
    expect(exitCode).toBe(0);
  });

  test("a macro waits for what another one left", async () => {
    const files = {
      "index.js": `
        const { port1, port2 } = new MessageChannel();
        port2.onmessage = () => (port2.close(), require("./second.js"));
        setImmediate(() => {
          require("./first.js");
          port1.postMessage("posts a task");
        });`,
      ...withMacro("first", `() => ((globalThis.left = ${noAdapter}), "first")`),
      ...withMacro("second", `async () => (await left, "second")`),
    };
    const { stdout, exitCode } = await run(files);
    expect(withoutMacroLog(stdout)).toBe("first\nsecond\n");
    expect(exitCode).toBe(0);
  });

  test("the program finishes what a macro left when node:vm ended it", async () => {
    const files = {
      "index.js": `
        require("./inlined.js");
        globalThis.load = () => require("./again.js");
        for (let timeout = 50; globalThis.spins !== "yes"; timeout *= 2) {
          globalThis.spins = "should";
          delete require.cache[require.resolve("./again.js")];
          try {
            require("node:vm").runInThisContext("load()", { timeout });
          } catch {}
        }
        console.log(await globalThis.left);`,
      ...withMacro(
        "inlined",
        `async () => {
          const first = ${noAdapter};
          globalThis.left = ${noAdapter};
          await first;
          while (globalThis.spins) globalThis.spins = "yes";
          return "loaded";
        }`,
      ),
      "again.js": `
        import { macro } from "./inlined-macro.js" with { type: "macro" };
        macro();`,
    };
    const { stdout, exitCode } = await run(files);
    expect(withoutMacroLog(stdout)).toBe("loaded\nnull\n");
    expect(exitCode).toBe(0);
  });
});

describe.skipIf(!hasAdapter).concurrent("the process", () => {
  test("ends while a device is idle", async () => {
    const script = `
      globalThis.device = await requestDevice();
      device.lost.then(() => console.log("lost"));
      process.on("exit", () => console.log("exit"));`;
    expect(await run({ "index.js": script })).toEqual(printed("exit"));
  });

  test("waits for what is under way", async () => {
    const script = `
      let settled = 0;
      for (const promise of startEverything(await requestDevice())) promise.then(() => settled++);
      process.on("exit", () => console.log(settled));`;
    expect(await run({ "index.js": script })).toEqual(printed("7"));
  });

  test("waits for lost once the device is destroyed", async () => {
    const script = `
      const device = await requestDevice();
      device.lost.then(({ reason }) => console.log(reason));
      device.destroy();`;
    expect(await run({ "index.js": script })).toEqual(printed("destroyed"));
  });

  test("prints an error that no scope captures and no listener cancels", async () => {
    const script = `
      const device = await requestDevice();
      device.onuncapturederror = event => { if (event.error.message.includes("canceled")) event.preventDefault(); };
      for (const label of ["canceled", "printed"]) device.createBuffer({ label, size: 4, usage: 0 });`;
    const { stdout, stderr, exitCode } = await run({ "index.js": script });
    expect({ stdout, stderr: stderr.trim(), exitCode }).toEqual({
      stdout: "",
      stderr: `Buffer usages must not be 0.\n - While calling [Device].CreateBuffer([BufferDescriptor ""printed""]).`,
      exitCode: 0,
    });
  });

  test("stops printing the errors of a device at some point", async () => {
    const script = `
      const device = await requestDevice();
      let events = 0;
      device.onuncapturederror = () => events++;
      for (let i = 0; i < 510; i++) device.createBuffer({ size: 4, usage: 0 });
      process.on("exit", () => console.log(events));`;
    const { stdout, stderr, exitCode } = await run({ "index.js": script });
    expect({
      stdout,
      errors: stderr.split("must not be 0").length - 1,
      last: stderr.trim().split("\n").at(-1),
    }).toEqual({
      stdout: "510\n",
      errors: 500,
      last: "WebGPU: too many warnings. This GPUDevice prints no more of them.",
    });
    expect(exitCode).toBe(0);
  });

  test("reports what a listener throws, and goes on", async () => {
    const script = `
      const device = await requestDevice();
      process.on("uncaughtException", error => console.log(error.message));
      device.onuncapturederror = event => { event.preventDefault(); throw new Error("thrown"); };
      device.createBuffer({ size: 4, usage: 0 });
      device.createBuffer({ size: 4, usage: 0 });
      await device.queue.onSubmittedWorkDone();
      console.log("done");`;
    expect(await run({ "index.js": script })).toEqual(printed("thrown\nthrown\ndone"));
  });

  test.skipIf(!isLinux)("finds no driver that runs on the CPU if it cannot make memory executable", async () => {
    const script = `
      import { dlopen } from "bun:ffi";
      const { prctl } = dlopen(${JSON.stringify(isLinux && libcPathForDlopen())}, {
        prctl: { args: ["i32", "u64", "u64", "u64", "u64"], returns: "i32" },
      }).symbols;
      const setMDWE = 65, refuseExecGain = 1;
      const isRefused = prctl(setMDWE, refuseExecGain, 0, 0, 0) === 0;
      for (const forceFallbackAdapter of [false, true]) {
        const adapter = await navigator.gpu.requestAdapter({ forceFallbackAdapter });
        console.log(isRefused && adapter !== null && adapter.info.isFallbackAdapter);
      }`;
    expect(await run({ "index.js": script })).toEqual(printed("false\nfalse"));
  });

  test("sleeps while it waits for the GPU", async () => {
    const script = `
      import { getEventLoopStats } from "bun:internal-for-testing";
      const device = await requestDevice();
      const results = Array.from({ length: 10 }, () => keepBusy(device, 30));
      const before = getEventLoopStats().iteration;
      await results.at(-1).mapAsync(GPUMapMode.READ);
      console.log(getEventLoopStats().iteration - before < 50);`;
    expect(await run({ "index.js": script })).toEqual(printed("true"));
  });

  test.each([
    ["mapAsync() before the next submit", "[early().mapAsync(GPUMapMode.READ), late()]"],
    ["mapAsync() after the next submit", "[[early(), late()][0].mapAsync(GPUMapMode.READ)]"],
    ["mapAsync() in a later task", "[[early(), late(), await new Promise(setImmediate)][0].mapAsync(GPUMapMode.READ)]"],
    ["onSubmittedWorkDone()", "[(early(), device.queue.onSubmittedWorkDone()), late()]"],
    [
      "with many waits for that",
      "[early().mapAsync(GPUMapMode.READ), late(), Array.from({ length: 600 }, () => device.queue.onSubmittedWorkDone())]",
    ],
  ])("does not wait for what was submitted later: %s", async (_, start) => {
    const script = `
      const device = await requestDevice();
      await keepBusy(device, 1).mapAsync(GPUMapMode.READ);
      // More each time, as the GPU may finish all of it before this thread gets to run.
      for (let workgroups = 60; workgroups < 65536; workgroups *= 4) {
        const [early, late] = [prepare(device, workgroups / 2), prepare(device, workgroups)];
        const [first] = ${start};
        const last = device.queue.onSubmittedWorkDone();
        await first;
        await new Promise(setImmediate);
        console.log(Bun.peek.status(last));
        if (Bun.peek.status(last) === "pending") break;
      }`;
    const { stdout, stderr, exitCode } = await run({ "index.js": script }, undefined, withoutGC);
    expect(stdout).toEndWith("pending\n");
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  });

  test("sleeps once the GPU is done and the memory is freed", async () => {
    const script = `
      import { getEventLoopStats } from "bun:internal-for-testing";
      const device = await requestDevice();
      await Promise.all(startEverything(device));
      keepBusy(device, 1).destroy();
      Bun.gc(true);
      const before = getEventLoopStats().iteration;
      await Bun.sleep(100);
      console.log(getEventLoopStats().iteration - before < 50);`;
    expect(await run({ "index.js": script })).toEqual(printed("true"));
  });

  test("does not miss what the GPU finishes just as it asks to be woken", async () => {
    const script = `
      const device = await requestDevice();
      const source = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_SRC });
      const target = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST });
      for (let i = 0; i < 500; i++) {
        const encoder = device.createCommandEncoder();
        encoder.copyBufferToBuffer(source, target);
        device.queue.submit([encoder.finish()]);
        for (let delay = (i % 64) * 200; delay > 0; delay--) globalThis.delay = delay;
        await device.queue.onSubmittedWorkDone();
      }
      console.log("done");`;
    expect(await run({ "index.js": script }, undefined, withoutGC)).toEqual(printed("done"));
  });

  test("sleeps through most of very many waits", async () => {
    const script = `
      import { getEventLoopStats } from "bun:internal-for-testing";
      const device = await requestDevice();
      const pipeline = device.createComputePipeline({ layout: "auto", compute: { module: slowModule(device, 0, 600) } });
      const resource = device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE });
      const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource }] });
      const waits = Array.from({ length: 1536 }, () => {
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline), pass.setBindGroup(0, bindGroup), pass.dispatchWorkgroups(1), pass.end();
        return encoder.finish();
      }).map(commands => (device.queue.submit([commands]), device.queue.onSubmittedWorkDone()));
      const before = getEventLoopStats().iteration;
      await Promise.all(waits);
      console.log(getEventLoopStats().iteration - before < 1000);`;
    expect(await run({ "index.js": script })).toEqual(printed("true"));
  });

  test.each([
    ["before the GPU has come to its mappings", "end()"],
    ["after the first of its mappings", "await results[0].then(end)"],
    [
      "and the next call unmaps what is left",
      `end(), device.destroy(), console.assert(buffers.every(buffer => buffer.mapState === "unmapped"))`,
    ],
  ])("destroys a device even if node:vm ends the script meanwhile, %s", async (_, start) => {
    const script = `
      const count = 300;
      for (let timeout = 20, depth = 1000, pending = 0; pending === 0 || pending >= count - 1; ) {
        const device = await requestDevice();
        const create = (usage, mappedAtCreation) => device.createBuffer({ size: 4, usage, mappedAtCreation });
        const buffers = Array.from({ length: count }, () => create(GPUBufferUsage.MAP_READ));
        const results = buffers.map(buffer => buffer.mapAsync(GPUMapMode.READ).then(() => "mapped", error => error.name));
        const range = create(GPUBufferUsage.COPY_SRC, true).getMappedRange();
        // Each rejection takes as long as the stack is deep.
        const destroy = depth => (depth ? destroy(depth - 1) + 1 : device.destroy());
        function end() {
          Error.stackTraceLimit = Infinity;
          try {
            require("node:vm").runInNewContext("destroy(depth)", { destroy, depth }, { timeout });
          } catch {}
          Error.stackTraceLimit = 10;
          pending = buffers.filter(buffer => buffer.mapState === "pending").length;
        }
        ${start};
        if (pending === 0) depth *= 2;
        else if (pending >= count - 1) timeout *= 2, device.destroy();
        else console.log(range.byteLength, (await device.lost).reason, [...new Set((await Promise.all(results)).slice(1))].join());
      }`;
    expect(await run({ "index.js": script })).toEqual(printed("0 destroyed AbortError"));
  });

  test.each(["device.destroy()", "buffer.destroy()", "buffer.unmap()", "texture.destroy()", "device.queue.submit([])"])(
    "ends though a listener of beforeExit calls %s",
    async call => {
      const script = `
      const device = await requestDevice();
      const buffer = device.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ });
      const texture = device.createTexture({ size: [1], format: "r8unorm", usage: GPUTextureUsage.COPY_DST });
      let calls = 0;
      process.on("beforeExit", () => (++calls < 10 ? ${call} : process.exit()));
      process.on("exit", () => console.log(calls < 10));`;
      expect(await run({ "index.js": script })).toEqual(printed("true"));
    },
  );

  test.each(["device.destroy()", "buffer.destroy()", "buffer.unmap()", "texture.destroy()", "querySet.destroy()"])(
    "sleeps under --hot though a listener of beforeExit calls %s",
    async call => {
      const script = `
        const device = await requestDevice();
        const buffer = device.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ });
        const texture = device.createTexture({ size: [1], format: "r8unorm", usage: GPUTextureUsage.COPY_DST });
        const querySet = device.createQuerySet({ type: "occlusion", count: 1 });
        let calls = 0;
        process.on("beforeExit", () => (calls++, ${call}));
        Bun.spawn([process.execPath, "-e", ""], { onExit: () => (console.log(calls < 20), process.exit(0)) }).unref();`;
      expect(await run({ "index.js": script }, ["--hot", "index.js"])).toEqual(printed("true"));
    },
  );

  const returnsFreedMemory = {
    ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0"].filter(Boolean).join(":"),
    // Or glibc raises it, and keeps what is below.
    MALLOC_MMAP_THRESHOLD_: "1048576",
  };

  test.each([
    ["buffers that it destroys", "buffer", "for (const it of all) it.destroy()"],
    ["textures that it destroys", "texture", "for (const it of all) it.destroy()"],
    ["buffers that are collected", "buffer", "(all.length = 0), Bun.gc(true)"],
    ["textures that are collected", "texture", "(all.length = 0), Bun.gc(true)"],
    ["buffers that bind groups hold to the last", "buffer", "await collectAfter(bindGroup)"],
    ["textures that views hold to the last", "texture", "await collectAfter(texture => texture.createView())"],
    ["buffers that render bundles hold to the last", "buffer", "await collectAfter(bundle)"],
    ["buffers that encoders hold to the last", "buffer", "await collectAfter(encode)"],
    [
      "buffers that the last submit holds to the last",
      "buffer",
      "await collectAfter(buffer => encode(buffer).finish(), all => device.queue.submit((globalThis.submitted = [...all])))",
    ],
  ])("gets back the memory of %s, though it submits nothing more", async (_, kind, release) => {
    const script = `
      const device = await requestDevice();
      const rss = () => process.memoryUsage.rss() >> 20;
      // 8 MB each
      const buffer = encoder => {
        const { COPY_DST, STORAGE, VERTEX } = GPUBufferUsage;
        const buffer = device.createBuffer({ size: 8 << 20, usage: COPY_DST | STORAGE | VERTEX });
        encoder.clearBuffer(buffer);
        return buffer;
      };
      const texture = encoder => {
        const view = device.createTexture({ size: [2048, 1024], format: "rgba8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT });
        encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: "clear", storeOp: "store" }] }).end();
        return view;
      };

      const layout = device.createBindGroupLayout({
        entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }],
      });
      const bindGroup = resource => device.createBindGroup({ layout, entries: [{ binding: 0, resource }] });
      function bundle(buffer) {
        const encoder = device.createRenderBundleEncoder({ colorFormats: ["r8unorm"] });
        encoder.setVertexBuffer(0, buffer);
        return encoder.finish();
      }
      function encode(buffer) {
        const encoder = device.createCommandEncoder();
        encoder.clearBuffer(buffer);
        return encoder;
      }
      async function collectAfter(hold, use) {
        const holders = all.splice(0).map(hold);
        Bun.gc(true);
        for (let i = 0; i < 3; i++) await device.queue.onSubmittedWorkDone();
        use?.(holders);
        holders.length = 0;
        Bun.gc(true);
      }

      function create() {
        const encoder = device.createCommandEncoder();
        const all = Array.from({ length: 8 }, () => ${kind}(encoder));
        device.queue.submit([(globalThis.commands = [encoder, encoder.finish()])[1]]);
        return all;
      }
      const all = create();
      let inUse = rss();
      await device.queue.onSubmittedWorkDone();
      inUse = Math.max(inUse, rss());
      // What frees the memory of that submit would free the rest by chance.
      for (let i = 0; i < 2; i++) await new Promise(setImmediate);
      await device.queue.onSubmittedWorkDone();
      ${release};
      // Only a driver that runs on the CPU has it in the RSS.
      const expected = device.adapterInfo.isFallbackAdapter ? 32 : -Infinity;
      const end = performance.now() + 30_000;
      do await Bun.sleep(1);
      while (inUse - rss() < expected && performance.now() < end);
      console.log(inUse - rss() < expected ? inUse - rss() + " MB" : "freed");`;
    const env = { ...bunEnv, ...returnsFreedMemory };
    expect(await run({ "index.js": script }, undefined, env)).toEqual(printed("freed"));
  });

  // Each upload fills a staging buffer. Dawn submits after four, and takes back those that the GPU is done with.
  const uploads = `
    const rss = () => process.memoryUsage.rss() >> 20;
    const pixels = new Uint8Array(4 << 20);
    function prepareUploads(device) {
      const texture = device.createTexture({ size: [1024, 1024], format: "rgba8unorm", usage: GPUTextureUsage.COPY_DST });
      return count => {
        while (count--) device.queue.writeTexture({ texture }, pixels, { bytesPerRow: 4096 }, [1024, 1024]);
      };
    }`;

  test("gets back the memory of uploads, though it submits nothing more", async () => {
    const script = `
      ${uploads}
      const devices = await Promise.all(Array.from({ length: 4 }, requestDevice));
      const uploaders = devices.map(prepareUploads);
      async function finish() {
        for (let i = 0; i < 3; i++) {
          for (const { queue } of devices) await queue.onSubmittedWorkDone();
          for (let i = 0; i < 2; i++) await new Promise(setImmediate);
        }
      }
      for (const upload of uploaders) upload(1);
      for (const { queue } of devices) queue.submit([]);
      await finish();
      for (const upload of uploaders) upload(4);
      const inUse = rss();
      await finish();
      // With Direct3D 12 it goes back to a pool of the device, which only the next uploads show.
      for (const upload of uploaders) upload(4);
      console.log(rss() - inUse);`;
    const { stdout, exitCode } = await run({ "index.js": script }, undefined, { ...withoutGC, ...returnsFreedMemory });
    // 48 if nothing comes back.
    expect(parseInt(stdout)).toBeLessThan(24);
    expect(exitCode).toBe(0);
  });

  test("gets back the memory of uploads before the event loop turns", async () => {
    const script = `
      ${uploads}
      const upload = prepareUploads(await requestDevice());
      const before = rss();
      let rounds = 0;
      do upload(4), Bun.sleepSync(++rounds);
      while (rounds * 16 - (rss() - before) < 64 && rounds < 24);
      console.log(rounds < 24);`;
    const env = { ...bunEnv, ...returnsFreedMemory };
    expect(await run({ "index.js": script }, undefined, env)).toEqual(printed("true"));
  });
});

describe.skipIf(!hasAdapter).concurrent("the garbage collector", () => {
  test("leaves what is under way", async () => {
    const script = `
      const promises = await requestDevice().then(startEverything);
      let pending = promises.length;
      for (const promise of promises) promise.then(() => pending--);
      while (pending > 0) {
        Bun.gc(true);
        await new Promise(setImmediate);
      }
      console.log((await Promise.all(promises)).map(String).join());`;
    expect(await run({ "index.js": script })).toEqual(
      printed(
        "undefined,undefined,[object GPUComputePipeline],[object GPUComputePipeline],[object GPUCompilationInfo],null,[object GPUAdapter]",
      ),
    );
  });

  test("does not make the process miss the end of what it waits for", async () => {
    const script = `
      const device = await requestDevice();
      for (let longWaits = 0, workgroups = 25; longWaits < 3; ) {
        const start = performance.now();
        const mapped = keepBusy(device, workgroups).mapAsync(GPUMapMode.READ);
        await new Promise(setImmediate);
        await new Promise(setImmediate);
        // Its finalizers run 100 ms later, when the event loop is about to sleep again.
        Bun.gc(false);
        await mapped;
        if (performance.now() - start < 120 && workgroups < 32768) workgroups *= 2;
        else longWaits++;
      }
      console.log("done");`;
    expect(await run({ "index.js": script }, undefined, withoutGCTimer)).toEqual(printed("done"));
  });

  test.skipIf(!isLinux).each([
    ["samplers", "device.createSampler()"],
    ["query sets", `device.createQuerySet({ type: "occlusion", count: 1 })`],
    ["pipelines", `device.createComputePipeline({ layout: "auto", compute: { module: slowModule(device, 0) } })`],
    ["pipelines that were compiled on another thread", "compile(device, 0)"],
    [
      "render pipelines",
      `device.createRenderPipeline({
        layout: "auto",
        vertex: { module: device.createShaderModule({ code: "@vertex fn main() -> @builtin(position) vec4f { return vec4f(); }" }) },
        depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "always" },
      })`,
    ],
  ])("has the driver free %s, which takes a submit", async (_, create) => {
    const script = `
      const device = await requestDevice();
      await device.queue.onSubmittedWorkDone();
      console.log(countWatchers());
      for (const end = performance.now() + 30_000; countWatchers() === 0 && performance.now() < end; ) {
        await (() => ${create})();
        Bun.gc(true);
        await Bun.sleep(1);
      }
      console.log(countWatchers());`;
    expect(await run({ "index.js": script })).toEqual(printed("0\n1"));
  });

  test("leaves the listeners of a device while something can report an error to it", async () => {
    const script = `
      const texture = device => device.createTexture({ size: [1], format: "r8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT });
      const endTwice = pass => (pass.end(), pass.end());
      const cases = {
        buffer: [device => device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST }), it => it.mapAsync(1).catch(() => {})],
        texture: [texture, it => it.createView({ baseMipLevel: 1 })],
        queue: [device => device.queue, async it => it.submit([(await requestDevice()).createCommandEncoder().finish()])],
        encoder: [device => device.createCommandEncoder(), it => (it.popDebugGroup(), it.finish())],
        computePass: [device => device.createCommandEncoder().beginComputePass(), endTwice],
        renderPass: [
          device => device.createCommandEncoder().beginRenderPass({ colorAttachments: [{ view: texture(device), loadOp: "load", storeOp: "store" }] }),
          endTwice,
        ],
        bundleEncoder: [device => device.createRenderBundleEncoder({ colorFormats: ["r8unorm"] }), it => (it.popDebugGroup(), it.finish())],
        pipeline: [device => compile(device, 0), it => it.getBindGroupLayout(99)],
      };
      for (const [name, [create, fail]] of Object.entries(cases)) {
        const { promise, resolve } = Promise.withResolvers();
        const object = await requestDevice().then(device => {
          device.onuncapturederror = event => (event.preventDefault(), resolve(event));
          return create(device);
        });
        Bun.gc(true);
        await fail(object);
        Bun.gc(true);
        const event = await promise;
        Bun.gc(true);
        console.log(name, event.target instanceof GPUDevice);
        event.target.destroy();
      }`;
    expect(await run({ "index.js": script })).toEqual(
      printed(
        ["buffer", "texture", "queue", "encoder", "computePass", "renderPass", "bundleEncoder", "pipeline"]
          .map(name => `${name} true`)
          .join("\n"),
      ),
    );
  });

  test("collects a device that nothing refers to, and does not report it as lost", async () => {
    const script = `
      import { heapStats } from "bun:jsc";
      for (let i = 0; i < 8; i++) {
        const device = await requestDevice();
        device.lost.then(() => console.log("lost"));
        await Promise.all(startEverything(device));
      }
      // One of these is the prototype, and the mapped range holds the last device.
      while (heapStats().objectTypeCounts.GPUDevice > 3) {
        Bun.gc(true);
        await new Promise(setImmediate);
      }
      console.log("collected");`;
    expect(await run({ "index.js": script })).toEqual(printed("collected"));
  });

  test("knows how much memory a buffer takes", async () => {
    const script = `
      import { heapStats } from "bun:jsc";
      const device = await requestDevice();
      for (let i = 0; i < 128; i++) device.createBuffer({ size: 2 << 20, usage: GPUBufferUsage.COPY_DST });
      console.log(heapStats().objectTypeCounts.GPUBuffer < 64);`;
    expect(await run({ "index.js": script })).toEqual(printed("true"));
  });
});

const withBusyWorker = (inWorker: string, onMessage: string) => ({
  "index.js": `
    const worker = new Worker("./worker.js");
    worker.onerror = event => event.preventDefault();
    worker.onmessage = () => { ${onMessage} };
    worker.addEventListener("close", () => console.log("closed"));`,
  "worker.js": `
    startEverything(await requestDevice());
    postMessage("started");
    ${inWorker}`,
});

describe.skipIf(!hasAdapter).concurrent("a worker", () => {
  test("has a GPU of its own", async () => {
    const files = {
      "index.js": `
        const result = keepBusy(await requestDevice());
        const messages = [1, 2, 3].map(() => new Promise(resolve => (new Worker("./worker.js").onmessage = resolve)));
        await result.mapAsync(GPUMapMode.READ);
        const expected = result.getMappedRange();
        for (const { data } of await Promise.all(messages)) console.log(data.byteLength, Bun.deepEquals(data, expected));`,
      "worker.js": `
        const result = keepBusy(await requestDevice());
        await result.mapAsync(GPUMapMode.READ);
        postMessage(result.getMappedRange());`,
    };
    expect(await run(files)).toEqual(printed("256 true\n256 true\n256 true"));
  });

  test.each([
    ["is terminated while it waits", "", "worker.terminate()"],
    ["is terminated while it runs", "for (;;);", "worker.terminate()"],
    ["calls process.exit()", "process.exit(0)", ""],
    ["throws", `throw new Error("thrown")`, ""],
    ["runs to its end", "", ""],
  ])("%s", async (_, inWorker, onMessage) => {
    expect(await run(withBusyWorker(inWorker, onMessage))).toEqual(printed("closed"));
  });

  test.skipIf(!isLinux)("leaves nothing of a device that it uses after its Bun.ModuleGraph is disposed", async () => {
    const files = {
      "index.js": `
        const count = () => require("node:fs").readdirSync("/proc/self/fd").length;
        const runWorker = () => new Promise(resolve => new Worker("./worker.js").addEventListener("close", resolve));
        await runWorker();
        const before = count();
        for (let i = 0; i < 4; i++) await runWorker();
        console.log(count() - before);`,
      "worker.js": `
        const graph = new Bun.ModuleGraph();
        const { queue } = (await graph.import(import.meta.dir + "/device.js")).device;
        graph.dispose();
        await new Promise(setImmediate);
        queue.submit([]);
        process.exit(0);`,
      "device.js": `export const device = await requestDevice();`,
    };
    expect(await run(files)).toEqual(printed("0"));
  });
});

describe.skipIf(!hasAdapter).concurrent("what can compile a shader", () => {
  // Up to the end of the stack, whose size does not depend on the system in a worker.
  const env = { ...bunEnv, BUN_JSC_maxPerThreadStackUsage: String(64 << 20) };

  test.each([
    ["requestAdapter()", "navigator.gpu.requestAdapter()"],
    ["requestDevice()", "adapter.requestDevice()"],
    ["createShaderModule()", "device.createShaderModule({ code })"],
    ["createComputePipeline()", "device.createComputePipeline(compute)"],
    ["createComputePipelineAsync()", "device.createComputePipelineAsync(compute)"],
    ["createRenderPipeline()", "device.createRenderPipeline(render)"],
    ["createRenderPipelineAsync()", "device.createRenderPipelineAsync(render)"],
    ["dispatchWorkgroupsIndirect()", "computePass.dispatchWorkgroupsIndirect(buffer, 0)"],
    ["end()", "renderPass.end()"],
    ["beginRenderPass()", "encoder.beginRenderPass(pass)"],
    ["copyBufferToTexture()", "encoder.copyBufferToTexture({ buffer }, { texture }, [1])"],
    ["copyTextureToBuffer()", "encoder.copyTextureToBuffer({ texture }, { buffer }, [1])"],
    ["copyTextureToTexture()", "encoder.copyTextureToTexture({ texture }, other, [1])"],
    ["resolveQuerySet()", "encoder.resolveQuerySet(querySet, 0, 1, buffer, 0)"],
    ["writeTexture()", "device.queue.writeTexture({ texture }, data, {}, [1])"],
    ["submit()", "device.queue.submit([])"],
  ])("%s wants more stack than a function does", async (_, call) => {
    const files = {
      "index.js": `new Worker("./worker.js");`,
      "worker.js": `
        const adapter = await navigator.gpu.requestAdapter();
        const device = await requestDevice();
        const code = \`
          @compute @workgroup_size(1) fn c() {}
          @vertex fn v() -> @builtin(position) vec4f { return vec4f(); }
          @fragment fn f() -> @location(0) vec4f { return vec4f(); }\`;
        const module = device.createShaderModule({ code });
        const format = "rgba8unorm";
        const compute = { layout: "auto", compute: { module } };
        const render = { layout: "auto", vertex: { module }, fragment: { module, targets: [{ format }] } };
        const buffer = device.createBuffer({ size: 256, usage: 0x3fc });
        const [texture, view] = [0, 1].map(() => device.createTexture({ size: [1], format, usage: 0x13 }));
        const other = { texture: view };
        const pass = { colorAttachments: [{ view, loadOp: "clear", storeOp: "store" }] };
        const querySet = device.createQuerySet({ type: "occlusion", count: 1 });
        const data = new Uint8Array(4);
        const encoder = device.createCommandEncoder();
        const computePass = device.createCommandEncoder().beginComputePass();
        computePass.setPipeline(device.createComputePipeline(compute));
        const renderPass = device.createCommandEncoder().beginRenderPass(pass);
        renderPass.setPipeline(device.createRenderPipeline(render));
        renderPass.setIndexBuffer(buffer, "uint16");
        renderPass.drawIndexedIndirect(buffer, 0);

        let attempts = 0;
        const results = [];
        const eightKilobytes = Array(1024).fill(0);
        (function recurse() {
          try {
            recurse(...eightKilobytes);
          } catch (overflow) {
            const result = (results[attempts++] = ${call});
            if (Bun.peek.status(result) === "rejected") throw overflow;
          }
        })();
        await Promise.allSettled(results);
        console.log(attempts > 64);`,
    };
    expect(await run(files, undefined, env)).toEqual(printed("true"));
  });
});

describe.skipIf(!hasAdapter).concurrent("other contexts", () => {
  test("the program finishes what a macro did not wait for", async () => {
    const files = {
      "index.js": `
        import { macro } from "./macro.js" with { type: "macro" };
        console.log(macro());`,
      "macro.js": `export const macro = () => (navigator.gpu.requestAdapter().then(() => console.log("after")), "before");`,
    };
    const { stdout, exitCode } = await run(files);
    expect(stdout).toEndWith("before\nafter\n");
    expect(exitCode).toBe(0);
  });

  test("a macro waits for the GPU while the program that imports it does", async () => {
    const files = {
      "index.js": `
        const outer = keepBusy(await requestDevice()).mapAsync(GPUMapMode.READ);
        require("./inlined.js");
        console.log(await outer);`,
      ...withMacro("inlined", `async () => (await Promise.all(startEverything(await requestDevice()))).length`),
    };
    const { stdout, exitCode } = await run(files);
    expect(withoutMacroLog(stdout)).toBe("7\nundefined\n");
    expect(exitCode).toBe(0);
  });

  test("a macro sleeps until the GPU is done", async () => {
    const files = {
      "index.js": `require("./inlined.js");`,
      ...withMacro("inlined", `async () => String(await keepBusy(await requestDevice()).mapAsync(GPUMapMode.READ))`),
    };
    const { stdout, exitCode } = await run(files, undefined, withoutGC);
    expect(withoutMacroLog(stdout)).toBe("undefined\n");
    expect(exitCode).toBe(0);
  });

  test("a macro waits after another one left the GPU busy", async () => {
    const files = {
      "index.js": `
        require("./first.js");
        await globalThis.left;
        require("./second.js");`,
      ...withMacro(
        "first",
        `async () => {
          const device = await requestDevice();
          globalThis.left = keepBusy(device).mapAsync(GPUMapMode.READ);
          await new Promise(setImmediate);
          await new Promise(setImmediate);
          return "first";
        }`,
      ),
      ...withMacro("second", `async () => (await requestDevice(), "second")`),
    };
    const { stdout, exitCode } = await run(files, undefined, withoutGC);
    expect(withoutMacroLog(stdout)).toBe("first\nsecond\n");
    expect(exitCode).toBe(0);
  });

  test("a macro waits for what another one left, which the GPU finished in between", async () => {
    const files = {
      "index.js": `
        keepBusy((globalThis.device = await requestDevice()));
        const done = device.queue.onSubmittedWorkDone();
        require("./first.js");
        await done;
        require("./second.js");`,
      ...withMacro(
        "first",
        `async () => {
          globalThis.left = device.queue.onSubmittedWorkDone();
          await new Promise(setImmediate);
          await new Promise(setImmediate);
          return "first";
        }`,
      ),
      ...withMacro("second", `async () => (await left, "second")`),
    };
    const { stdout, exitCode } = await run(files, undefined, withoutGC);
    expect(withoutMacroLog(stdout)).toBe("first\nsecond\n");
    expect(exitCode).toBe(0);
  });

  test.skipIf(!isLinux)("a macro gets back the memory of what it destroys", async () => {
    const files = withMacro(
      "inlined",
      `async () => {
        const device = await requestDevice();
        const before = process.memoryUsage.rss();
        for (let i = 0; i < 24; i++) {
          const buffer = device.createBuffer({ size: 16 << 20, usage: GPUBufferUsage.STORAGE, mappedAtCreation: true });
          buffer.unmap();
          buffer.destroy();
          await new Promise(setImmediate);
          await new Promise(setImmediate);
        }
        return (process.memoryUsage.rss() - before) >> 20;
      }`,
    );
    const { stdout, exitCode } = await run({ "index.js": `require("./inlined.js");`, ...files });
    // 770 if nothing comes back.
    expect(Number(withoutMacroLog(stdout))).toBeLessThan(isASAN || isDebug ? 400 : 300);
    expect(exitCode).toBe(0);
  });

  test("a macro hears what it makes a device of the program report", async () => {
    const files = {
      "index.js": `
        globalThis.device = await requestDevice();
        device.onuncapturederror = event => (event.preventDefault(), console.log(event.error.message.match(/""(.*)""/)[1]));
        require("./inlined.js");`,
      ...withMacro(
        "inlined",
        `async () => {
          for (const label of ["one", "two"]) {
            device.createBuffer({ label, size: 4, usage: 0 });
            await device.queue.onSubmittedWorkDone();
          }
          device.destroy();
          return (await device.lost).reason;
        }`,
      ),
    };
    const { stdout, exitCode } = await run(files);
    expect(withoutMacroLog(stdout)).toBe("one\ntwo\ndestroyed\n");
    expect(exitCode).toBe(0);
  });

  test("a macro does not change the order of what a device reports", async () => {
    const files = {
      "index.js": `
        globalThis.device = await requestDevice();
        device.onuncapturederror = event => (event.preventDefault(), console.log("error"));
        device.createBuffer({ size: 4, usage: 0 });
        keepBusy(device).mapAsync(GPUMapMode.READ).then(() => console.log("mapped"));
        require("./inlined.js");`,
      ...withMacro(
        "inlined",
        `async () => {
          await device.queue.onSubmittedWorkDone();
          console.log("done");
          device.createBuffer({ size: 4, usage: 0 });
          device.destroy();
          return (await device.lost).reason;
        }`,
      ),
    };
    const { stdout, exitCode } = await run(files);
    expect(withoutMacroLog(stdout)).toBe("error\nmapped\ndone\nerror\ndestroyed\n");
    expect(exitCode).toBe(0);
  });

  test.each(["inlined-macro.js", "inlined.js"])(
    "the event loop turns for each frame, though the GPU is done before the script is: %s",
    async file => {
      const files = {
        "index.js": `console.log(await require("./${file}").macro?.() ?? "");`,
        ...withMacro(
          "inlined",
          `async () => {
            const device = await requestDevice();
            const source = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_SRC });
            const target = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST });
            let turns = 0;
            let immediate = setImmediate(function count() { turns++, (immediate = setImmediate(count)); });
            let pending = device.queue.onSubmittedWorkDone();
            const turnOfFrame = [];
            for (let i = 0; i < 40; i++) {
              // What the CPU has to do for a frame.
              Bun.sleepSync(2);
              const encoder = device.createCommandEncoder();
              encoder.copyBufferToBuffer(source, target);
              device.queue.submit([encoder.finish()]);
              const next = device.queue.onSubmittedWorkDone();
              await pending;
              pending = next;
              turnOfFrame.push(turns);
            }
            clearImmediate(immediate);
            // Two are in flight, which may be found done at once.
            return turnOfFrame.every((turn, i) => turn !== turnOfFrame[i + 2]);
          }`,
        ),
      };
      const { stdout, exitCode } = await run(files);
      expect(withoutMacroLog(stdout).trim()).toBe("true");
      expect(exitCode).toBe(0);
    },
  );

  test("a macro of Bun.build(), which has a thread of the bundler", async () => {
    const files = {
      "index.js": `
        for (let i = 0; i < 2; i++) {
          const { outputs } = await Bun.build({ entrypoints: ["./inlined.js"], target: "bun" });
          console.log((await outputs[0].text()).includes("console.log(7)"));
        }`,
      ...withMacro(
        "inlined",
        `async () => {
          const device = await requestDevice();
          const { length } = await Promise.all(startEverything(device));
          device.destroy();
          return length;
        }`,
      ),
    };
    const { stdout, exitCode } = await run(files);
    expect(withoutMacroLog(stdout)).toBe("true\ntrue\n");
    expect(exitCode).toBe(0);
  });

  test("a Bun.ModuleGraph is disposed between two mappings of its device", async () => {
    const files = {
      "index.js": `
        const graph = new Bun.ModuleGraph();
        const { device } = await graph.import(import.meta.dir + "/device.js");
        const map = () => device.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ }).mapAsync(GPUMapMode.READ);
        const [, { reason }] = await Promise.allSettled([map().then(() => graph.dispose()), map()]);
        console.log(reason?.name);`,
      "device.js": `export const device = await requestDevice();`,
    };
    expect(await run(files)).toEqual(printed("AbortError"));
  });

  test("a ShadowRealm and a context of node:vm", async () => {
    const script = `
      const use = gpu => gpu.requestAdapter().then(adapter => adapter.requestDevice()).then(device => (device.destroy(), device.lost));
      const inRealm = new Promise(new ShadowRealm().evaluate(\`resolve => { (\${use})(navigator.gpu).then(lost => resolve(lost.reason)); }\`));
      const inContext = require("node:vm").runInNewContext(\`(\${use})(gpu)\`, { gpu: navigator.gpu });
      Bun.gc(true);
      console.log(await inRealm, (await inContext).reason);`;
    expect(await run({ "index.js": script })).toEqual(printed("destroyed destroyed"));
  });
});

// Last and one at a time: the Apple Paravirtual device then fails the pipelines that other processes are compiling.
describe.skipIf(!hasAdapter)("the process ends while a pipeline compiles", () => {
  test("at process.exit()", async () => {
    const script = `
      for (const promise of startEverything(await requestDevice())) promise.finally(() => console.log("settled"));
      console.log("exit");
      process.exit(0);`;
    expect(await run({ "index.js": script })).toEqual(printed("exit"));
  });

  test("for a worker", async () => {
    expect(await run(withBusyWorker("for (;;);", `console.log("exit"), process.exit(0)`))).toEqual(printed("exit"));
  });

  test("for a file of bun test --isolate, which drops what that leaves under way", async () => {
    const file = (name: string) => `
      import { test } from "bun:test";
      console.log("load ${name}");
      test("starts", async () => {
        const device = await requestDevice();
        device.lost.then(() => console.log("lost"));
        keepBusy(device, 300);
        for (const promise of startEverything(device).slice(0, 4)) promise.then(() => console.log("${name}"), () => console.log("aborted"));
      });`;
    const files = { "a.test.js": file("a"), "b.test.js": file("b") };
    const { stdout, stderr, exitCode } = await run(files, ["test", "--isolate"]);
    // What is done before the file ends is fulfilled.
    expect(stdout).toMatch(/\nload (a|b)\n(\1\n){0,4}load (a|b)\n(\3\n){0,4}$/);
    expect(stderr).toContain(" 2 pass");
    expect(exitCode).toBe(0);
  });
});
