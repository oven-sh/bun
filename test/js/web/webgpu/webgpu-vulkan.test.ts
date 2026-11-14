import { beforeAll, describe, expect, test } from "bun:test";
import { compileFixture, isLinux, isMusl } from "harness";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { hasAdapter, runWithDriverOfChrome } from "./driver";
import { bunEnv, printed, run, uploads, withMacro, withoutGC, withoutMacroLog } from "./subprocess";

runWithDriverOfChrome(import.meta.path);

const canCompileC = Bun.which("cc") || Bun.which("clang") || Bun.which("gcc");

describe.skipIf(!isLinux || !hasAdapter || !canCompileC).concurrent("the Vulkan driver", () => {
  let env: typeof bunEnv;
  beforeAll(() => {
    const fixture = compileFixture(join(import.meta.dir, "vulkan-loader-fixture.c"), { flags: ["-ldl", "-lpthread"] });
    const loader = join(dirname(fixture), "libvulkan.so.1");
    if (!existsSync(loader)) symlinkSync(fixture, loader);
    env = {
      ...withoutGC,
      LD_LIBRARY_PATH: [dirname(fixture), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":"),
      VULKAN_LOADER: readFileSync("/proc/self/maps", "latin1").match(/\S+\/libvulkan\.so\S*/)![0],
    };
  });

  const prelude = `
    import { dlopen } from "bun:ffi";
    const counters = ["descriptorPools", "devices", "frees", "images", "memoryBlocks", "pipelines", "queryPools", "samplers", "submits", "waits"];
    const { symbols: driver, close } = dlopen("libvulkan.so.1", {
      ...Object.fromEntries(counters.map(name => [name, { returns: "int" }])),
      ...Object.fromEntries(["failThreads", "failWaits", "findNotReady", "holdWaitsFrom", "loseDevice"].map(name => [name, { args: ["int"] }])),
    });
    process.on("exit", () => (driver.holdWaitsFrom(0), close()));
    async function until(condition, step = () => Bun.sleep(1)) {
      for (const end = performance.now() + 30_000; !condition() && performance.now() < end; ) await step();
      return condition();
    }
    async function pause() {
      for (let i = 0; i < 3; i++) await new Promise(setImmediate);
    }
    ${uploads}`;
  const withGC = { BUN_JSC_useGC: "1" };
  const runWithDevice = (script: string, options = {}, args?: string[]) =>
    run({ "index.js": `${prelude} const device = await requestDevice(); ${script}` }, args, {
      ...env,
      ...options,
    });

  test.each([
    ["samplers", "samplers", "device.createSampler({ lodMaxClamp: i })"],
    ["query sets", "queryPools", `device.createQuerySet({ type: "occlusion", count: 1 })`],
    ["empty buffers", "memoryBlocks", "device.createBuffer({ size: 0, usage: GPUBufferUsage.MAP_READ })"],
    [
      "transient attachments",
      "images",
      `device.createTexture({ size: [1], format: "r8unorm", usage: RENDER_ATTACHMENT | TRANSIENT_ATTACHMENT })`,
    ],
    [
      "bind groups and their layouts",
      "descriptorPools",
      `device.createBindGroup({
        layout: device.createBindGroupLayout({ entries: [{ binding: i, visibility: GPUShaderStage.COMPUTE, sampler: {} }] }),
        entries: [{ binding: i, resource: device.createSampler() }],
      })`,
    ],
    [
      "pipelines",
      "pipelines",
      `device.createComputePipeline({ layout: "auto", compute: { module: slowModule(device, i) } })`,
    ],
    ["pipelines that were compiled on another thread", "pipelines", "compile(device, i)"],
    [
      "render pipelines",
      "pipelines",
      `device.createRenderPipeline({
        layout: "auto",
        vertex: { module: device.createShaderModule({ code: "@vertex fn main() -> @builtin(position) vec4f { return vec4f(); }" }) },
        depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "always", depthBias: i },
      })`,
    ],
  ])("frees %s that are collected", async (_, counter, create) => {
    const script = `
      const { RENDER_ATTACHMENT, TRANSIENT_ATTACHMENT } = GPUTextureUsage;
      const before = driver.${counter}();
      const all = await Promise.all(Array.from({ length: 4 }, (_, i) => ${create}));
      console.log(driver.${counter}() - before);
      all.length = 0;
      console.log(await until(() => driver.${counter}() - before < 2, () => (Bun.gc(true), Bun.sleep(1))));`;
    expect(await runWithDevice(script, withGC)).toEqual(printed("4\ntrue"));
  });

  test.each([
    ["that nothing submits", "upload(3)"],
    ["that Dawn submits", "upload(4)"],
    ["that use them again", "upload(3), queue.submit([]), await queue.onSubmittedWorkDone(), upload(3)"],
    ["though it is out of memory to wait for the GPU", "driver.failWaits(-1), upload(4)"],
  ])("frees the staging buffers of uploads %s", async (_, start) => {
    const script = `
      const { queue } = device;
      const upload = prepareUploads(device);
      await queue.onSubmittedWorkDone();
      const before = driver.memoryBlocks();
      ${start};
      console.log(driver.memoryBlocks() > before);
      console.log(await until(() => driver.memoryBlocks() < before));`;
    expect(await runWithDevice(script)).toEqual(printed("true\ntrue"));
  });

  test.each([
    [
      "that ends between two looks at the GPU",
      "driver.findNotReady(2), queue.submit([]), await queue.onSubmittedWorkDone()",
    ],
    ["in a later task", "await pause(), driver.findNotReady(1), queue.submit([])"],
  ])("frees what is destroyed before a submit %s", async (_, submit) => {
    const script = `
      const { queue } = device;
      prepareUploads(device);
      await queue.onSubmittedWorkDone();
      const [blocks, submits] = [driver.memoryBlocks(), driver.submits()];
      device.createBuffer({ size: 8 << 20, usage: GPUBufferUsage.COPY_DST }).destroy();
      const start = performance.now();
      ${submit};
      const extra = Math.floor((performance.now() - start) / 100);
      console.log(await until(() => driver.memoryBlocks() === blocks), driver.submits() - submits <= 1 + extra);`;
    expect(await runWithDevice(script)).toEqual(printed("true true"));
  });

  test("frees what a macro destroys before that returns", async () => {
    const files = {
      "index.js": `${prelude} Object.assign(globalThis, { driver, until }); require("./inlined.js");`,
      ...withMacro(
        "inlined",
        `async () => {
          const device = await requestDevice();
          const before = driver.memoryBlocks();
          device.createBuffer({ size: 8 << 20, usage: GPUBufferUsage.COPY_DST }).destroy();
          return until(() => driver.memoryBlocks() === before);
        }`,
      ),
    };
    const { stdout, exitCode } = await run(files, undefined, env);
    expect(withoutMacroLog(stdout)).toBe("true\n");
    expect(exitCode).toBe(0);
  });

  test("frees the staging buffers of uploads while another device is busy", async () => {
    const script = `
      const { queue } = await requestDevice();
      const upload = prepareUploads(device);
      const before = driver.memoryBlocks();
      upload(3);
      console.log(await until(() => driver.memoryBlocks() < before, () => (queue.submit([]), queue.onSubmittedWorkDone())));`;
    expect(await runWithDevice(script)).toEqual(printed("true"));
  });

  test("frees the staging buffers of uploads while small ones follow", async () => {
    const script = `
      const upload = prepareUploads(device);
      const texture = device.createTexture({ size: [1], format: "r8unorm", usage: GPUTextureUsage.COPY_DST });
      const uploadTexel = () => (device.queue.writeTexture({ texture }, pixels, {}, [1]), Bun.sleep(1));
      await device.queue.onSubmittedWorkDone();
      const before = driver.memoryBlocks();
      uploadTexel();
      upload(1);
      console.log(await until(() => driver.memoryBlocks() === before, uploadTexel));
      const submits = driver.submits();
      for (let i = 0; i < 10; i++) await uploadTexel();
      console.log(driver.submits() - submits);`;
    expect(await runWithDevice(script)).toEqual(printed("true\n0"));
  });

  test("frees most staging buffers of a device that stays busy", async () => {
    const script = `
      const upload = prepareUploads(device);
      await device.queue.onSubmittedWorkDone();
      const before = driver.memoryBlocks();
      driver.findNotReady(3);
      upload(16);
      console.log(driver.memoryBlocks() - before);
      for (let i = 0; i < 8; i++) driver.findNotReady(0), device.queue.submit([]);
      console.log(driver.memoryBlocks() - before);`;
    expect(await runWithDevice(script)).toEqual(printed("15\n7"));
  });

  test.each([
    ["Dawn submits", "upload(4)"],
    ["the script submits", "upload(3), queue.submit([])"],
    ["the script waits for", "upload(3), queue.submit([]), await queue.onSubmittedWorkDone()"],
    ["a pause follows", "upload(3), queue.submit([]), await queue.onSubmittedWorkDone(), await Bun.sleep(5)"],
  ])("has its staging buffers used again in a loop of uploads that %s", async (_, round) => {
    const script = `
      const { queue } = device;
      const upload = prepareUploads(device);
      const [blocks, frees] = [driver.memoryBlocks(), driver.frees()];
      for (let i = 0; i < 6; i++) driver.findNotReady(0), ${round};
      console.log(driver.memoryBlocks() - blocks < 8, driver.frees() - frees);`;
    expect(await runWithDevice(script)).toEqual(printed("true 0"));
  });

  test.each([
    ["goes on at once", "submit(); create().destroy(); await finish()"],
    ["waits twice", "submit(); create().destroy(); await finish(); await finish()"],
    ["pauses", "submit(); create().destroy(); await finish(); await pause()"],
    ["uploads to a buffer that can be mapped", "device.queue.writeBuffer(buffer, 0, pixels, 0, 4); await pause()"],
  ])("gets one submit in 100 ms at most besides those of a script that %s", async (_, round) => {
    const script = `
      const create = () => device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const buffer = create();
      let expected = driver.submits();
      function submit() {
        const encoder = device.createCommandEncoder();
        encoder.clearBuffer(buffer);
        device.queue.submit([encoder.finish()]);
        expected++;
      }
      const finish = () => device.queue.onSubmittedWorkDone();
      const start = performance.now();
      submit();
      for (let i = 0; i < 10; i++) { ${round}; }
      console.log(driver.submits() - expected <= (performance.now() - start) / 100);`;
    expect(await runWithDevice(script)).toEqual(printed("true"));
  });

  test.each([
    ["between two looks at the GPU", "driver.holdWaitsFrom(1); driver.findNotReady(3); submitBoth()"],
    [
      "before the thread that waits is asked for it",
      `driver.holdWaitsFrom(2);
      driver.findNotReady(1000);
      submitBoth();
      await until(() => driver.waits() === 2);
      driver.findNotReady(2)`,
    ],
  ])("is not waited for any longer if a submit ends %s", async (_, start) => {
    const script = `
      const [submitFirst, submitSecond] = [prepare(device), prepare(device)];
      let first;
      const submitBoth = () => ((first = submitFirst()), submitSecond());
      ${start};
      await first.mapAsync(GPUMapMode.READ);
      console.log(first.mapState);`;
    expect(await runWithDevice(script)).toEqual(printed("mapped"));
  });

  test("is not waited for any longer once a mapping is canceled", async () => {
    const script = `
      driver.holdWaitsFrom(1);
      driver.findNotReady(1000);
      const buffer = keepBusy(device);
      buffer.mapAsync(GPUMapMode.READ).catch(error => console.log(error.name));
      await until(() => driver.waits() === 1);
      buffer.unmap();`;
    expect(await runWithDevice(script)).toEqual(printed("AbortError"));
  });

  test("is asked again after a pause if a wait fails", async () => {
    const script = `
      const submit = prepare(device);
      driver.failWaits(-1);
      driver.findNotReady(10);
      const start = performance.now();
      await submit().mapAsync(GPUMapMode.READ);
      console.log(driver.waits() <= performance.now() - start + 1);`;
    expect(await runWithDevice(script)).toEqual(printed("true"));
  });

  test.skipIf(isMusl).each([
    ["a mapping", "driver.findNotReady(10), await submit().mapAsync(GPUMapMode.READ)"],
    ["memory", "driver.findNotReady(4), buffer.destroy(), submit(), await until(() => driver.frees() > 0)"],
    ["the loss of the device", "driver.loseDevice(4), submit(), await device.lost"],
  ])("is looked at if no thread can be started to wait for %s", async (_, wait) => {
    const script = `
      const buffer = device.createBuffer({ size: 8 << 20, usage: GPUBufferUsage.COPY_DST });
      const submit = prepare(device, 1);
      const timer = setTimeout(() => process.exit(1), 30_000);
      driver.failThreads(1);
      console.log((${wait}) !== false, driver.waits());
      driver.failThreads(0);
      clearTimeout(timer);`;
    expect(await runWithDevice(script, { BUN_JSC_useConcurrentJIT: "0" })).toEqual(printed("true 0"));
  });

  test("loses a device that has work under way", async () => {
    const script = `
      const submit = prepare(device);
      driver.loseDevice(20);
      const mapped = submit().mapAsync(GPUMapMode.READ).catch(error => error.name);
      console.log(await mapped, await device.queue.onSubmittedWorkDone(), (await device.lost).reason);
      console.log(await until(() => countWatchers() === 0));`;
    expect(await runWithDevice(script)).toEqual(printed("AbortError undefined unknown\ntrue"));
  });

  test.each([
    ["at a submit that nothing waits for", "driver.loseDevice(20), device.queue.submit([])"],
    ["in a loop of uploads", "driver.loseDevice(0), upload(12)"],
    ["at the submit that frees memory", "driver.loseDevice(0), buffer.destroy()"],
  ])("loses a device %s", async (_, lose) => {
    const script = `
      const buffer = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST });
      const upload = prepareUploads(device);
      await device.queue.onSubmittedWorkDone();
      const timer = setTimeout(() => {}, 30_000);
      device.lost.then(({ reason }) => (console.log(reason), clearTimeout(timer)));
      ${lose};`;
    expect(await runWithDevice(script)).toEqual(printed("unknown"));
  });

  test("is left alone under --hot though a listener of beforeExit submits to a device that it has lost", async () => {
    const script = `
      driver.loseDevice(0);
      device.queue.submit([]);
      await device.lost;
      let calls = 0;
      process.on("beforeExit", () => (calls++, device.queue.submit([])));
      Bun.spawn([process.execPath, "-e", ""], { onExit: () => (console.log(calls < 50), process.exit(0)) }).unref();`;
    expect(await runWithDevice(script, {}, ["--hot", "index.js"])).toEqual(printed("true"));
  });

  test("destroys a busy device that a macro of Bun.build() leaves behind", async () => {
    const files = {
      "index.js": `
        ${prelude}
        for (let i = 0; i < 2; i++) await Bun.build({ entrypoints: ["./inlined.js"], target: "bun" });
        console.log(driver.submits() > 0);
        console.log(await until(() => driver.devices() === 0));`,
      ...withMacro("inlined", "async () => void keepBusy(await requestDevice())"),
    };
    const { stdout, exitCode } = await run(files, undefined, { ...env, ...withGC });
    expect(withoutMacroLog(stdout)).toBe("true\ntrue\n");
    expect(exitCode).toBe(0);
  });
});
