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
    const counters = ["descriptorPools", "devices", "frees", "images", "looks", "memoryBlocks", "pipelines", "queryPools", "samplers", "submits", "waits"];
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
  const reasonOfLoss = expect.stringContaining("VK_ERROR_DEVICE_LOST");
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
    ["an idle GPU", "", "0 0 0 0"],
    ["a submit", "queue.submit([])", "1 1 0 1"],
    ["an upload", "queue.writeTexture({ texture }, pixels, {}, [1])", "1 1 0 1"],
    ["an upload to something else", "queue.writeTexture({ texture: other }, pixels, {}, [1])", "1 1 0 1"],
  ])("frees what is destroyed once it has finished what may use it: %s", async (_, use, expected) => {
    const script = `
      const { queue } = device;
      const create = () => device.createTexture({ size: [1], format: "r8unorm", usage: GPUTextureUsage.COPY_DST });
      const other = create();
      const before = driver.images();
      const texture = create();
      driver.holdWaitsFrom(1);
      driver.findNotReady(1000);
      ${use};
      texture.destroy();
      const left = [driver.images() - before];
      await pause();
      left.push(driver.images() - before);
      driver.findNotReady(0);
      driver.holdWaitsFrom(0);
      await until(() => driver.images() === before);
      console.log(...left, driver.images() - before, driver.submits());`;
    expect(await runWithDevice(script)).toEqual(printed(expected));
  });

  test.each([
    ["small buffers", "memoryBlocks", 8, "device.createBuffer({ size: 1 << 20, usage: GPUBufferUsage.COPY_DST })"],
    ["bind groups", "descriptorPools", 512, "device.createBindGroup({ layout, entries: [{ binding: 0, resource }] })"],
  ])("has the room of %s used again without a submit", async (_, counter, count, create) => {
    const script = `
      const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, sampler: {} }] });
      const resource = device.createSampler();
      const before = driver.${counter}();
      for (let i = 0; i < 6; i++) {
        for (let i = 0; i < ${count}; i++) ${create};
        Bun.gc(true);
        await pause();
      }
      console.log(driver.${counter}() - before < 4, driver.submits());`;
    expect(await runWithDevice(script, withGC)).toEqual(printed("true 0"));
  });

  test.each([
    ["that Dawn submits", "upload(4)"],
    ["that use them again", "upload(3), queue.submit([]), await queue.onSubmittedWorkDone(), upload(3)"],
    ["though it is out of memory to wait for the GPU", "driver.failWaits(-1), upload(4)"],
  ])("frees all staging buffers but one after uploads %s", async (_, start) => {
    const script = `
      const { queue } = device;
      const upload = prepareUploads(device);
      await queue.onSubmittedWorkDone();
      const before = driver.memoryBlocks();
      ${start};
      console.log(driver.memoryBlocks() > before);
      console.log(await until(() => driver.memoryBlocks() === before));`;
    expect(await runWithDevice(script)).toEqual(printed("true\ntrue"));
  });

  test("frees staging buffers though the script never submits", async () => {
    const script = `
      const texture = device.createTexture({ size: [1024, 1024], format: "rgba8unorm", usage: GPUTextureUsage.COPY_DST });
      const before = driver.memoryBlocks();
      for (let i = 0; i < 3; i++) device.queue.writeTexture({ texture }, pixels, { bytesPerRow: 4096 }, [1024, 1024]);
      console.log(driver.memoryBlocks() - before, await until(() => driver.memoryBlocks() === before + 1));`;
    expect(await runWithDevice(script)).toEqual(printed("3 true"));
  });

  test("frees what is destroyed after a submit that ends between two looks at the GPU", async () => {
    const script = `
      const before = driver.memoryBlocks();
      driver.findNotReady(2);
      device.queue.submit([]);
      device.createBuffer({ size: 8 << 20, usage: GPUBufferUsage.COPY_DST }).destroy();
      await device.queue.onSubmittedWorkDone();
      console.log(driver.memoryBlocks() - before);`;
    expect(await runWithDevice(script)).toEqual(printed("0"));
  });

  test("frees what is destroyed under --hot, which runs no timers while it waits for a change", async () => {
    const script = `
      const before = driver.images();
      const texture = device.createTexture({ size: [1], format: "r8unorm", usage: GPUTextureUsage.COPY_DST });
      device.queue.writeTexture({ texture }, pixels, {}, [1]);
      texture.destroy();
      let calls = 0;
      process.on("beforeExit", () => {
        if (driver.images() === before || ++calls === 30) console.log(driver.images() - before), process.exit(0);
      });`;
    expect(await runWithDevice(script, {}, ["--hot", "index.js"])).toEqual(printed("0"));
  });

  test("frees what a macro destroys before that returns", async () => {
    const files = {
      "index.js": `${prelude} Object.assign(globalThis, { driver, until }); require("./inlined.js");`,
      ...withMacro(
        "inlined",
        `async () => {
          const device = await requestDevice();
          const before = driver.memoryBlocks();
          driver.findNotReady(1);
          device.queue.submit([]);
          device.createBuffer({ size: 8 << 20, usage: GPUBufferUsage.COPY_DST }).destroy();
          return until(() => driver.memoryBlocks() === before);
        }`,
      ),
    };
    const { stdout, exitCode } = await run(files, undefined, env);
    expect(withoutMacroLog(stdout)).toBe("true\n");
    expect(exitCode).toBe(0);
  });

  test("frees staging buffers while another device is busy", async () => {
    const script = `
      const { queue } = await requestDevice();
      const upload = prepareUploads(device);
      await device.queue.onSubmittedWorkDone();
      const before = driver.memoryBlocks();
      upload(3);
      console.log(await until(() => driver.memoryBlocks() === before, () => (queue.submit([]), queue.onSubmittedWorkDone())));`;
    expect(await runWithDevice(script)).toEqual(printed("true"));
  });

  test("frees staging buffers while small uploads follow, and is then left alone", async () => {
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
      // An idle device is looked at after 500 ms.
      for (const end = performance.now() + 600; performance.now() < end; ) await uploadTexel();
      console.log(driver.submits() - submits);`;
    expect(await runWithDevice(script)).toEqual(printed("true\n0"));
  });

  test.each([
    ["submits", "queue.submit([])"],
    ["only has things destroyed", "device.createQuerySet({ type: 'occlusion', count: 1 }).destroy()"],
  ])("frees the staging buffers that are no longer used by a device that %s", async (_, use) => {
    const script = `
      const { queue } = device;
      const upload = prepareUploads(device);
      await queue.onSubmittedWorkDone();
      const before = driver.memoryBlocks();
      driver.findNotReady(3);
      upload(16);
      console.log(driver.memoryBlocks() - before);
      for (let i = 0; i < 8; i++) driver.findNotReady(0), queue.submit([]);
      console.log(driver.memoryBlocks() - before <= 7);
      console.log(await until(() => driver.memoryBlocks() === before, () => (${use}, Bun.sleep(1))));`;
    expect(await runWithDevice(script)).toEqual(printed("15\ntrue\ntrue"));
  });

  test.each([
    ["Dawn submits", 6, "upload(4)"],
    ["the script submits", 6, "upload(3), queue.submit([])"],
    ["the script waits for", 6, "upload(3), queue.submit([]), await queue.onSubmittedWorkDone()"],
    // An idle device is looked at after 500 ms.
    ["pauses follow", 14, "upload(2), queue.submit([]), await queue.onSubmittedWorkDone(), await Bun.sleep(50)"],
  ])("has its staging buffers used again in a loop of uploads that %s", async (_, rounds, round) => {
    const script = `
      const { queue } = device;
      const upload = prepareUploads(device);
      for (let i = 0; i < 2; i++) driver.findNotReady(0), queue.submit([]);
      const [blocks, frees] = [driver.memoryBlocks(), driver.frees()];
      for (let i = 0; i < ${rounds}; i++) driver.findNotReady(0), ${round};
      console.log(driver.memoryBlocks() - blocks < 8, driver.frees() - frees);`;
    expect(await runWithDevice(script)).toEqual(printed("true 0"));
  });

  test.each([
    ["goes on at once", "submit(); create().destroy(); await finish()"],
    ["waits twice", "submit(); create().destroy(); await finish(); await finish()"],
    ["pauses", "submit(); create().destroy(); await finish(); create().destroy(); await pause()"],
    ["uploads", "upload(1); create().destroy(); submit(); await finish(); Bun.gc(true); await pause()"],
    ["waits after an upload", "uploadTexel(); create().destroy(); await finish(); submit(); await finish()"],
    ["gets its result late", "driver.findNotReady(2); submit(); uploadTexel(); create().destroy(); await finish()"],
    [
      "pauses after an upload",
      "uploadTexel(); queue.writeBuffer(buffer, 0, pixels, 0, 4); await pause(); submit(); await finish()",
    ],
  ])("gets no submits but those of a script that %s", async (_, round) => {
    const script = `
      const { queue } = device;
      const create = () => device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const buffer = create();
      const texture = device.createTexture({ size: [1], format: "r8unorm", usage: GPUTextureUsage.COPY_DST });
      const upload = prepareUploads(device);
      function submit() {
        const encoder = device.createCommandEncoder();
        encoder.clearBuffer(buffer);
        queue.submit([(globalThis.commands = [encoder, encoder.finish()])[1]]);
      }
      const uploadTexel = () => queue.writeTexture({ texture }, pixels, {}, [1]);
      const finish = () => queue.onSubmittedWorkDone();
      await finish();
      const before = driver.submits();
      for (let i = 0; i < 10; i++) { ${round}; }
      console.log(driver.submits() - before);`;
    expect(await runWithDevice(script, withGC)).toEqual(printed("10"));
  });

  test.each([
    ["now and then while the script has results", "", "device.queue.onSubmittedWorkDone()", [4, 16]],
    [
      "not while it is busy",
      "driver.holdWaitsFrom(1), driver.findNotReady(1000), device.queue.submit([])",
      "pause()",
      [1, 1],
    ],
  ])("gets the uploads that hold what is destroyed %s", async (_, start, wait, [least, most]) => {
    const script = `
      const before = driver.images();
      ${start};
      for (let i = 0; i < 40; i++) {
        const texture = device.createTexture({ size: [1], format: "r8unorm", usage: GPUTextureUsage.COPY_DST });
        device.queue.writeTexture({ texture }, pixels, {}, [1]);
        texture.destroy();
        await ${wait};
      }
      console.log(driver.submits() >= ${least} && driver.submits() <= ${most});
      driver.findNotReady(0);
      driver.holdWaitsFrom(0);
      console.log(await until(() => driver.images() === before));`;
    expect(await runWithDevice(script)).toEqual(printed("true\ntrue"));
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

  test("is not looked at while a thread waits for it", async () => {
    const script = `
      driver.holdWaitsFrom(1);
      driver.findNotReady(1000);
      device.queue.submit([]);
      await until(() => driver.waits() === 1);
      await pause();
      const before = driver.looks();
      await pause();
      console.log(driver.looks() - before);
      driver.findNotReady(0);`;
    expect(await runWithDevice(script)).toEqual(printed("0"));
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

  // musl has a limit for the size of a stack.
  describe.skipIf(isMusl)("is looked at if no thread can be started to wait", () => {
    const withoutThreads = { BUN_JSC_useConcurrentJIT: "0" };

    test("for a mapping, also under --hot after an error, which runs no timers", async () => {
      const script = `
        const submit = prepare(device, 1);
        setImmediate(() => { throw new Error("unhandled"); });
        setImmediate(async () => {
          driver.failThreads(1);
          driver.findNotReady(30);
          console.log(await submit().mapAsync(GPUMapMode.READ), driver.waits());
          driver.failThreads(0);
          process.exit(0);
        });`;
      const { stdout, exitCode } = await runWithDevice(script, withoutThreads, ["--hot", "index.js"]);
      expect({ stdout, exitCode }).toEqual({ stdout: "undefined 0\n", exitCode: 0 });
    });

    test.each([
      ["to free memory", "driver.findNotReady(0), await until(() => driver.frees() > 0)", ""],
      ["to find the device lost", "driver.loseDevice(0), await device.lost", reasonOfLoss],
    ])("now and then %s", async (_, wait, stderr) => {
      const script = `
        const timer = setTimeout(() => process.exit(1), 30_000);
        driver.failThreads(1);
        driver.findNotReady(1000);
        device.queue.submit([]);
        device.createBuffer({ size: 8 << 20, usage: GPUBufferUsage.COPY_DST }).destroy();
        await pause();
        const before = driver.looks();
        await pause();
        console.log(driver.looks() - before < 2, (${wait}) !== false, driver.waits());
        driver.failThreads(0);
        clearTimeout(timer);`;
      expect(await runWithDevice(script, withoutThreads)).toEqual({ ...printed("true true 0"), stderr });
    });
  });

  test("loses a device that has work under way", async () => {
    const script = `
      const submit = prepare(device);
      driver.loseDevice(20);
      const mapped = submit().mapAsync(GPUMapMode.READ).catch(error => error.name);
      console.log(await mapped, await device.queue.onSubmittedWorkDone(), (await device.lost).reason);
      console.log(await until(() => countWatchers() === 0));`;
    expect(await runWithDevice(script)).toEqual({
      ...printed("AbortError undefined unknown\ntrue"),
      stderr: reasonOfLoss,
    });
  });

  test.each([
    ["an error", 1],
    ["more errors than are printed", 510],
  ])("says why it lost a device, after %s and before what follows ends the process", async (_, errors) => {
    const script = `
      for (let i = 0; i < ${errors}; i++) device.createBuffer({ size: 4, usage: 0 });
      const submit = prepare(device);
      driver.loseDevice(20);
      await submit().mapAsync(GPUMapMode.READ);`;
    const { stderr, exitCode } = await runWithDevice(script);
    expect(stderr).toMatch(/must not be 0[^]*VK_ERROR_DEVICE_LOST[^]*AbortError/);
    expect(exitCode).toBe(1);
  });

  test("loses a device that has been collected but for a mapping", async () => {
    const script = `
      async function start() {
        const device = await requestDevice();
        const buffer = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        const encoder = device.createCommandEncoder();
        encoder.clearBuffer(buffer);
        driver.findNotReady(1000);
        device.queue.submit([encoder.finish()]);
        device.queue.writeBuffer(buffer, 0, pixels, 0, 4);
        driver.loseDevice(0);
        return [buffer.mapAsync(GPUMapMode.READ).catch(error => error.name)];
      }
      const [mapped] = await start();
      Bun.gc(true);
      console.log(await mapped);`;
    expect(await runWithDevice(script, withGC)).toEqual({ ...printed("AbortError"), stderr: reasonOfLoss });
  });

  test.each([
    ["at a submit that nothing waits for", "driver.loseDevice(20), device.queue.submit([])"],
    ["in a loop of uploads", "driver.loseDevice(0), upload(12)"],
    ["at the submit that frees memory", "driver.loseDevice(0), upload(1), buffer.destroy()"],
  ])("loses a device %s", async (_, lose) => {
    const script = `
      const buffer = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST });
      const upload = prepareUploads(device);
      await device.queue.onSubmittedWorkDone();
      const timer = setTimeout(() => {}, 30_000);
      device.lost.then(({ reason }) => (console.log(reason), clearTimeout(timer)));
      ${lose};`;
    expect(await runWithDevice(script)).toEqual({ ...printed("unknown"), stderr: reasonOfLoss });
  });

  test("is left alone under --hot though a listener of beforeExit submits to a device that it has lost", async () => {
    const script = `
      driver.loseDevice(0);
      device.queue.submit([]);
      await device.lost;
      let calls = 0;
      process.on("beforeExit", () => (calls++, device.queue.submit([])));
      Bun.spawn([process.execPath, "-e", ""], { onExit: () => (console.log(calls < 50), process.exit(0)) }).unref();`;
    expect(await runWithDevice(script, {}, ["--hot", "index.js"])).toEqual({
      ...printed("true"),
      stderr: reasonOfLoss,
    });
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
