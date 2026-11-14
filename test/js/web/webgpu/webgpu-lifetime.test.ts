// Runs alone: its last tests disturb other processes that use the GPU of a macOS virtual machine.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, libcPathForDlopen, tempDir } from "harness";
import { hasAdapter, runWithDriverOfChrome } from "./driver";

runWithDriverOfChrome(import.meta.path);

const helpers = `
  import { readdirSync, readFileSync } from "node:fs";
  /** On Linux, the devices that have waited for the GPU and are not destroyed. */
  export const countWatchers = () => readdirSync("/proc/self/task").filter(thread => {
    try { return readFileSync(\`/proc/self/task/\${thread}/comm\`, "utf8") === "GPUQueue\\n"; } catch {}
  }).length;
  export const requestDevice = async () => (await navigator.gpu.requestAdapter()).requestDevice();
  export const slowModule = (device, seed) => device.createShaderModule({ code: \`
    @group(0) @binding(0) var<storage, read_write> out: array<u32, 64>;
    @compute @workgroup_size(64) fn main(@builtin(local_invocation_index) index: u32) {
      var x = index + \${seed};
      for (var i = 0; i < 10000; i++) { x = x * 1664525 + 1013904223; }
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

const withHelpers = (files: Record<string, string>) =>
  tempDir("webgpu", {
    ...Object.fromEntries(Object.entries(files).map(([name, source]) => [name, imports + source])),
    "helpers.js": helpers,
  });

async function run(files: Record<string, string>, args = ["index.js"], env = bunEnv) {
  using dir = withHelpers(files);
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

  test("timers and immediates run while a script waits for nothing else", async () => {
    const script = `
      let pending = 2;
      setTimeout(() => pending--, 1);
      setImmediate(() => pending--);
      while (pending > 0) await ${noAdapter};
      console.log("done");`;
    expect(await run({ "index.js": script })).toEqual(printed("done"));
  });

  test("promises settle after an unhandled error under --hot", async () => {
    const script = `
      setImmediate(() => {
        require("node:fs").stat(".", () => ${noAdapter}.then(adapter => (console.log(adapter), process.exit(0))));
        throw new Error("unhandled");
      });`;
    const { stdout, stderr, exitCode } = await run({ "index.js": script }, ["--hot", "index.js"]);
    expect(stderr).toContain("error: unhandled");
    expect({ stdout, exitCode }).toEqual({ stdout: "null\n", exitCode: 0 });
  });

  test("a macro does not continue the program", async () => {
    const files = {
      "index.js": `
        const started = ${noAdapter}.then(() => console.log("program")).then(() => new Promise(setImmediate));
        require("./inlined.js");
        await started;
        console.log("done");`,
      ...withMacro("inlined", `async () => String(await ${noAdapter})`),
    };
    const { stdout, exitCode } = await run(files);
    expect(withoutMacroLog(stdout)).toBe("null\nprogram\ndone\n");
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
        globalThis.load = () => require("./inlined.js");
        try {
          require("node:vm").runInThisContext("load()", { timeout: 1000 });
        } catch {}
        console.log(await globalThis.left);`,
      ...withMacro(
        "inlined",
        `async () => {
          const first = ${noAdapter};
          globalThis.left = ${noAdapter};
          await first;
          for (;;);
        }`,
      ),
    };
    const { stdout, exitCode } = await run(files);
    expect(withoutMacroLog(stdout)).toMatch(/^(null|undefined)\n$/);
    expect(exitCode).toBe(0);
  });

  test("timers and immediates run while a macro waits for nothing else", async () => {
    const files = withMacro(
      "inlined",
      `async () => {
        let pending = 2;
        setTimeout(() => pending--, 1);
        setImmediate(() => pending--);
        while (pending > 0) await ${noAdapter};
        return "done";
      }`,
    );
    const { stdout, exitCode } = await run({ "index.js": `require("./inlined.js");`, ...files });
    expect(withoutMacroLog(stdout)).toBe("done\n");
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
      const results = Array.from({ length: 10 }, () => keepBusy(device));
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
  ])("does not wait for what was submitted later: %s", async (_, start) => {
    const script = `
      const device = await requestDevice();
      // A finalizer would look at the queue by chance.
      const createBuffer = device.createBuffer.bind(device);
      globalThis.buffers = [];
      device.createBuffer = descriptor => buffers[buffers.push(createBuffer(descriptor)) - 1];
      await keepBusy(device).mapAsync(GPUMapMode.READ);
      // More each time, as the GPU may finish all of it before this thread gets to run.
      for (let workgroups = 1000; workgroups <= 64000; workgroups *= 4) {
        const [early, late] = [prepare(device, 400), prepare(device, workgroups)];
        const [first] = ${start};
        const last = device.queue.onSubmittedWorkDone();
        await first;
        await new Promise(setImmediate);
        console.log(Bun.peek.status(last));
        if (Bun.peek.status(last) === "pending") break;
      }`;
    const { stdout, stderr, exitCode } = await run({ "index.js": script });
    expect(stdout).toEndWith("pending\n");
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  });

  test("destroys a device even if node:vm ends the script meanwhile", async () => {
    const script = `
      const buffer = (device, usage, mappedAtCreation) => device.createBuffer({ size: 4, usage, mappedAtCreation });
      for (let timeout = 1; timeout <= 4; timeout++) {
        const device = await requestDevice();
        const pending = Array.from({ length: 2000 }, () => buffer(device, GPUBufferUsage.MAP_READ).mapAsync(GPUMapMode.READ));
        const range = buffer(device, GPUBufferUsage.COPY_SRC, true).getMappedRange();
        try {
          require("node:vm").runInNewContext("device.destroy()", { device }, { timeout });
        } catch {}
        device.destroy();
        const results = await Promise.allSettled(pending);
        console.log(range.byteLength, [...new Set(results.map(result => result.reason.name))].join());
      }`;
    expect(await run({ "index.js": script })).toEqual(printed(Array(4).fill("0 AbortError").join("\n")));
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
      for (let i = 0; i < 8; i++) {
        const mapped = keepBusy(device, 600).mapAsync(GPUMapMode.READ);
        await new Promise(setImmediate);
        await new Promise(setImmediate);
        // Its finalizers run when the event loop is about to sleep.
        Bun.gc(false);
        await mapped;
      }
      console.log("done");`;
    const env = { ...bunEnv, BUN_GC_TIMER_DISABLE: "1" };
    expect(await run({ "index.js": script }, undefined, env)).toEqual(printed("done"));
  });

  test.skipIf(!isLinux)("does not wait for the GPU to destroy a device", async () => {
    const script = `
      let outlived = false;
      // More each time, as the GPU may be done by then.
      for (let workgroups = 1000; workgroups <= 64000 && !outlived; workgroups *= 4) {
        await requestDevice().then(device => void keepBusy(device, workgroups));
        await new Promise(setImmediate);
        Bun.gc(true);
        outlived = countWatchers() > 0;
      }
      while (countWatchers() > 0) {
        await new Promise(setImmediate);
        Bun.gc(true);
      }
      console.log(outlived);`;
    expect(await run({ "index.js": script })).toEqual(printed("true"));
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

  // See test/js/web/workers/worker-late-completion.test.ts.
  test.skipIf(!isDebug && !isASAN)("is woken while it is torn down", async () => {
    using dir = withHelpers({
      "index.js": `
        // An import would wait at the gate.
        const worker = new (require("node:worker_threads").Worker)(\`
          const { compile, requestDevice } = require("./helpers.js");
          requestDevice().then(async device => {
            // One that is done before the worker first looks needs no wake.
            for (let seed = 0, pipeline; Bun.peek.status(pipeline) !== "pending"; seed++) {
              pipeline = compile(device, seed);
              await new Promise(setImmediate);
            }
            process.exit(0);
          });\`, { eval: true });
        await Promise.all([new Promise(resolve => worker.on("exit", resolve)), Bun.stdin.text()]);
        console.log("closed");`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      cwd: String(dir),
      env: { ...bunEnv, BUN_DEBUG_TEST_WORKER_TEARDOWN_GATE: "1" },
      stdin: "pipe",
      stderr: "pipe",
    });
    const latePost = "[vm] late post: WebGpuProcessEvents (";
    let stderr = "";
    for await (const chunk of proc.stderr) {
      stderr += Buffer.from(chunk).toString();
      if (stderr.includes(latePost)) proc.stdin.end();
    }
    expect(stderr).toContain(latePost);
    expect(await proc.stdout.text()).toBe("closed\n");
    expect(await proc.exited).toBe(0);
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
          globalThis.left = keepBusy(device, 2000).mapAsync(GPUMapMode.READ);
          await new Promise(setImmediate);
          await new Promise(setImmediate);
          return "first";
        }`,
      ),
      ...withMacro("second", `async () => (await requestDevice(), "second")`),
    };
    const { stdout, exitCode } = await run(files);
    expect(withoutMacroLog(stdout)).toBe("first\nsecond\n");
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

  test("a macro does not hear what the program makes a device of another macro report", async () => {
    const files = {
      "index.js": `
        require("./first.js");
        device.onuncapturederror = event => (event.preventDefault(), console.log(event.error.message.match(/""(.*)""/)[1]));
        for (const label of ["one", "two"]) {
          device.createBuffer({ label, size: 4, usage: 0 });
          require("./" + label + ".js");
        }`,
      ...withMacro("first", `async () => ((globalThis.device = await requestDevice()), "first")`),
      ...withMacro("one", `async () => (await device.queue.onSubmittedWorkDone(), "second")`),
      ...withMacro("two", `async () => (await device.queue.onSubmittedWorkDone(), "third")`),
    };
    const { stdout, exitCode } = await run(files);
    expect(withoutMacroLog(stdout)).toBe("first\nsecond\nthird\none\ntwo\n");
    expect(exitCode).toBe(0);
  });

  test("a macro of Bun.build(), which has a thread of the bundler", async () => {
    const files = {
      "index.js": `
        for (let i = 0; i < 2; i++) {
          const { outputs } = await Bun.build({ entrypoints: ["./inlined.js"], target: "bun" });
          console.log((await outputs[0].text()).includes("console.log(7)"));
        }
        while (process.platform === "linux" && countWatchers() > 0) await new Promise(setImmediate);`,
      ...withMacro(
        "inlined",
        `async () => {
          const device = await requestDevice();
          const { length } = await Promise.all(startEverything(device));
          globalThis.range = undefined;
          keepBusy(device);
          return length;
        }`,
      ),
    };
    const { stdout, exitCode } = await run(files);
    expect(withoutMacroLog(stdout)).toBe("true\ntrue\n");
    expect(exitCode).toBe(0);
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
        keepBusy(device, 1000);
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
