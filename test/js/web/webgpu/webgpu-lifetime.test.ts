// Runs alone: its last tests disturb other processes that use the GPU of a macOS virtual machine.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, libcPathForDlopen, tempDir } from "harness";
import { hasAdapter, runWithDriverOfChrome } from "./driver";

runWithDriverOfChrome(import.meta.path);

const helpers = `
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
  /** A buffer to map once the GPU is done. */
  export function keepBusy(device) {
    const pipeline = device.createComputePipeline({ layout: "auto", compute: { module: slowModule(device, 0) } });
    const resource = device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const result = device.createBuffer({ size: 256, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource }] }));
    pass.dispatchWorkgroups(100);
    pass.end();
    encoder.copyBufferToBuffer(resource, result);
    device.queue.submit([encoder.finish()]);
    return result;
  }
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
const imports = `import { compile, keepBusy, requestDevice, slowModule, startEverything } from "./helpers.js";\n`;

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
      "inlined.js": `
        import { macro } from "./macro.js" with { type: "macro" };
        console.log(macro());`,
      "macro.js": `export const macro = async () => (await Promise.all(startEverything(await requestDevice()))).length;`,
    };
    const { stdout, exitCode } = await run(files);
    // A debug build prints "[macro] call macro" first.
    expect(stdout).toEndWith("7\nundefined\n");
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
    const file = `
      import { test } from "bun:test";
      test("starts", async () => {
        const device = await requestDevice();
        for (const promise of [device.lost, ...startEverything(device).slice(0, 4)]) promise.finally(() => console.log("settled"));
      });`;
    const { stdout, stderr, exitCode } = await run({ "a.test.js": file, "b.test.js": file }, ["test", "--isolate"]);
    expect(stdout).not.toContain("settled");
    expect(stderr).toContain(" 2 pass");
    expect(exitCode).toBe(0);
  });
});
