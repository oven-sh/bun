// `navigator.gpu` is only in a build with `--webgpu=on` (scripts/build/config.ts).
//
// Most of this runs on Dawn's Null backend, which validates every call and needs no GPU. It keeps the memory of buffers,
// so what is written to one can be read back, and it runs no command buffer. "on a GPU" needs an adapter: a GPU, or a
// software one like Mesa's lavapipe.
import { webgpuIsDeviceLost, webgpuUseNullBackend } from "bun:internal-for-testing";
import { heapStats } from "bun:jsc";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { promises as fs } from "node:fs";
import { join } from "node:path";

declare const navigator: any;
declare const GPUBufferUsage: any, GPUMapMode: any, GPUTextureUsage: any, GPUShaderStage: any, GPUColorWrite: any;
const g = globalThis as any;

const hasWebGPU = typeof navigator.gpu === "object";
/** Of a GPU, or of software that stands in for one. `null` on a machine that has neither. */
const deviceOfGPU = hasWebGPU ? ((await (await navigator.gpu.requestAdapter())?.requestDevice()) ?? null) : null;

async function rejection(promise: Promise<unknown>): Promise<any> {
  return promise.then(
    value => {
      throw new Error(`resolved with ${Bun.inspect(value)}`);
    },
    reason => reason,
  );
}

/** What `run` throws. */
function thrown(run: () => unknown): any {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("it did not throw");
}

async function validationErrorOf(device: any, run: () => unknown): Promise<any> {
  device.pushErrorScope("validation");
  run();
  return device.popErrorScope();
}

const useNullBackend = `require("bun:internal-for-testing").webgpuUseNullBackend(true);\n`;

async function run(script: string, { prologue = useNullBackend, env = {} } = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", prologue + script],
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.skipIf(hasWebGPU)("a build without WebGPU has none of its names", () => {
  expect("gpu" in navigator).toBe(false);
  expect("dawn" in process.versions).toBe(false);
  expect(Object.getOwnPropertyNames(globalThis).filter(name => /^(GPU|WGSL)/.test(name))).toEqual([]);
});

describe.skipIf(!hasWebGPU)("WebGPU", () => {
  let device: any;
  const newDevice = async (descriptor?: unknown) => (await navigator.gpu.requestAdapter()).requestDevice(descriptor);

  /** Of `device`: a test that means to make an error catches it. */
  const uncapturedErrors: string[] = [];

  beforeAll(async () => {
    webgpuUseNullBackend(true);
    device = await newDevice();
    device.onuncapturederror = (event: any) => {
      event.preventDefault();
      uncapturedErrors.push(event.error.message);
    };
  });

  afterAll(async () => {
    // Errors are reported before what was asked for after them is answered.
    await device.queue.onSubmittedWorkDone();
    expect(uncapturedErrors).toEqual([]);
  });

  describe("interfaces", () => {
    test("every interface is a global that is not enumerable and cannot be constructed", () => {
      const names = Object.getOwnPropertyNames(globalThis).filter(name => /^(GPU|WGSL)/.test(name));
      expect(names.toSorted()).toMatchInlineSnapshot(`
        [
          "GPU",
          "GPUAdapter",
          "GPUAdapterInfo",
          "GPUBindGroup",
          "GPUBindGroupLayout",
          "GPUBuffer",
          "GPUBufferUsage",
          "GPUColorWrite",
          "GPUCommandBuffer",
          "GPUCommandEncoder",
          "GPUCompilationInfo",
          "GPUCompilationMessage",
          "GPUComputePassEncoder",
          "GPUComputePipeline",
          "GPUDevice",
          "GPUDeviceLostInfo",
          "GPUError",
          "GPUInternalError",
          "GPUMapMode",
          "GPUOutOfMemoryError",
          "GPUPipelineError",
          "GPUPipelineLayout",
          "GPUQuerySet",
          "GPUQueue",
          "GPURenderBundle",
          "GPURenderBundleEncoder",
          "GPURenderPassEncoder",
          "GPURenderPipeline",
          "GPUSampler",
          "GPUShaderModule",
          "GPUShaderStage",
          "GPUSupportedFeatures",
          "GPUSupportedLimits",
          "GPUTexture",
          "GPUTextureUsage",
          "GPUTextureView",
          "GPUUncapturedErrorEvent",
          "GPUValidationError",
          "WGSLLanguageFeatures",
        ]
      `);
      const constructible = [
        "GPUValidationError",
        "GPUOutOfMemoryError",
        "GPUInternalError",
        "GPUPipelineError",
        "GPUUncapturedErrorEvent",
      ];
      for (const name of names) {
        const { value, ...attributes } = Object.getOwnPropertyDescriptor(globalThis, name)!;
        expect({ name, ...attributes }).toEqual({ name, writable: true, enumerable: false, configurable: true });
        expect(g[name]).toBe(value);
        if (typeof value !== "function") continue;
        expect(value.name).toBe(name);
        expect(Object.prototype.toString.call(value.prototype)).toBe(`[object ${name}]`);
        if (!constructible.includes(name)) expect(() => new value()).toThrow("Illegal constructor");
      }
    });

    test.concurrent("a global can be replaced", async () => {
      const result = await run(`
        globalThis.GPUBuffer = 1;
        delete globalThis.GPUTexture;
        console.log(GPUBuffer, typeof GPUTexture, typeof GPUSampler);
      `);
      expect(result).toEqual({ stdout: "1 undefined function\n", stderr: "", exitCode: 0 });
    });

    test("the namespaces hold the constants of the specification", () => {
      expect({ ...GPUBufferUsage }).toEqual({
        MAP_READ: 0x0001,
        MAP_WRITE: 0x0002,
        COPY_SRC: 0x0004,
        COPY_DST: 0x0008,
        INDEX: 0x0010,
        VERTEX: 0x0020,
        UNIFORM: 0x0040,
        STORAGE: 0x0080,
        INDIRECT: 0x0100,
        QUERY_RESOLVE: 0x0200,
      });
      expect({ ...GPUMapMode }).toEqual({ READ: 1, WRITE: 2 });
      expect({ ...GPUTextureUsage }).toEqual({
        COPY_SRC: 0x01,
        COPY_DST: 0x02,
        TEXTURE_BINDING: 0x04,
        STORAGE_BINDING: 0x08,
        RENDER_ATTACHMENT: 0x10,
        TRANSIENT_ATTACHMENT: 0x20,
      });
      expect({ ...GPUShaderStage }).toEqual({ VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 });
      expect({ ...GPUColorWrite }).toEqual({ RED: 1, GREEN: 2, BLUE: 4, ALPHA: 8, ALL: 15 });
      expect(String(GPUBufferUsage)).toBe("[object GPUBufferUsage]");
    });

    test("the members of an interface are as WebIDL defines them, and can be replaced", () => {
      const module = device.createShaderModule({ code: "@compute @workgroup_size(1) fn main() {}" });
      const texture = device.createTexture({ size: [1], format: "r8unorm", usage: 4 });
      const objects: Record<string, any> = {
        gpu: navigator.gpu,
        info: device.adapterInfo,
        limits: device.limits,
        features: device.features,
        device,
        queue: device.queue,
        buffer: device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST }),
        texture,
        view: texture.createView(),
        sampler: device.createSampler(),
        module,
        pipeline: device.createComputePipeline({ layout: "auto", compute: { module } }),
        encoder: device.createCommandEncoder(),
        querySet: device.createQuerySet({ type: "occlusion", count: 1 }),
        error: new g.GPUValidationError(""),
        pipelineError: new g.GPUPipelineError("", { reason: "internal" }),
        event: new g.GPUUncapturedErrorEvent("", { error: new g.GPUInternalError("") }),
      };
      for (const [name, object] of Object.entries(objects)) {
        // What it inherits from has some: where an error was made, and whether an event is trusted.
        const like = { event: new Event(""), pipelineError: thrown(() => structuredClone(() => {})) }[name] ?? {};
        expect([name, Object.getOwnPropertyNames(object)]).toEqual([name, Object.getOwnPropertyNames(like)]);
        const prototype = Object.getPrototypeOf(object);
        const enumerated: string[] = [];
        for (const key in object) enumerated.push(key);
        const { constructor, ...members } = Object.getOwnPropertyDescriptors(prototype);
        expect(constructor).toEqual({
          value: g[prototype[Symbol.toStringTag]],
          writable: true,
          enumerable: false,
          configurable: true,
        });
        expect(Object.getOwnPropertyDescriptor(constructor.value, "prototype")).toEqual({
          value: prototype,
          writable: false,
          enumerable: false,
          configurable: false,
        });
        for (const [key, descriptor] of Object.entries(members)) {
          const member = `${name}.${key}`;
          expect([member, descriptor.enumerable, descriptor.configurable]).toEqual([member, true, true]);
          expect(enumerated).toContain(key);
          if ("value" in descriptor) {
            expect([member, typeof descriptor.value, descriptor.writable]).toEqual([member, "function", true]);
            prototype[key] = () => "replaced";
            expect([member, object[key]()]).toEqual([member, "replaced"]);
            prototype[key] = descriptor.value;
            continue;
          }
          expect([member, descriptor.get!.name]).toEqual([member, `get ${key}`]);
          expect(() => descriptor.get!.call({})).toThrow(TypeError);
          if (!descriptor.set) expect(() => void (object[key] = 1)).toThrow(TypeError);
          const value = object[key];
          Object.defineProperty(prototype, key, { get: () => "replaced" });
          expect([member, object[key]]).toEqual([member, "replaced"]);
          Object.defineProperty(prototype, key, descriptor);
          expect(object[key]).toBe(value);
          expect(Object.getOwnPropertyDescriptor(prototype, key)).toEqual(descriptor);
        }
      }
      for (const name of ["limits", "device", "buffer"]) expect(() => [...objects[name]]).toThrow(TypeError);
    });

    test("interfaces inherit from the interfaces that the specification says", () => {
      for (const [derived, base] of [
        [g.GPUDevice, EventTarget],
        [g.GPUUncapturedErrorEvent, Event],
        [g.GPUPipelineError, DOMException],
        [g.GPUValidationError, g.GPUError],
        [g.GPUOutOfMemoryError, g.GPUError],
        [g.GPUInternalError, g.GPUError],
      ]) {
        expect(Object.getPrototypeOf(derived)).toBe(base);
        expect(Object.getPrototypeOf(derived.prototype)).toBe(base.prototype);
      }
    });

    test("a device is an EventTarget like any other", () => {
      const calls: string[] = [];
      const patched = ["addEventListener", "dispatchEvent", "removeEventListener"] as const;
      const originals = patched.map(key => EventTarget.prototype[key]);
      for (const [i, key] of patched.entries())
        (EventTarget.prototype as any)[key] = function (...args: unknown[]) {
          calls.push(key);
          return (originals[i] as Function).apply(this, args);
        };
      try {
        const heard: Event[] = [];
        const listener = (event: Event) => heard.push(event);
        const event = new Event("anything");
        device.addEventListener("anything", listener);
        device.addEventListener("anything", { handleEvent: listener }, { once: true });
        expect(device.dispatchEvent(event)).toBe(true);
        device.removeEventListener("anything", listener);
        device.dispatchEvent(new Event("anything"));
        expect(heard).toEqual([event, event]);
        expect(event.target).toBe(device);
        expect(calls).toEqual([
          "addEventListener",
          "addEventListener",
          "dispatchEvent",
          "removeEventListener",
          "dispatchEvent",
        ]);
      } finally {
        for (const [i, key] of patched.entries()) (EventTarget.prototype as any)[key] = originals[i];
      }
    });

    test("a GPUUncapturedErrorEvent is an Event like any other", () => {
      const event = new g.GPUUncapturedErrorEvent("uncapturederror", {
        error: new g.GPUValidationError("the message"),
      });
      const target = new EventTarget();
      const heard: unknown[] = [];
      target.addEventListener("uncapturederror", event => heard.push(event));
      target.dispatchEvent(event);
      expect(heard).toEqual([event]);
      expect(heard[0]).toBe(event);
    });

    test("process.versions says which Dawn it is", () => {
      expect(process.versions.dawn).toMatch(/^[0-9a-f]{40}$/);
    });

    test("navigator.gpu is always the same object", () => {
      expect(navigator.gpu).toBeInstanceOf(g.GPU);
      expect(navigator.gpu).toBe(navigator.gpu);
      expect(navigator.gpu.wgslLanguageFeatures).toBe(navigator.gpu.wgslLanguageFeatures);
      expect(navigator.gpu.getPreferredCanvasFormat()).toBe("bgra8unorm");
    });

    test("a setlike is read as a Set is", () => {
      const features = navigator.gpu.wgslLanguageFeatures;
      expect(features).toBeInstanceOf(g.WGSLLanguageFeatures);
      const names = [...features];
      expect(names).toContain("pointer_composite_access");
      expect(features.size).toBe(names.length);
      expect(features.has("pointer_composite_access")).toBe(true);
      expect(features.has("nothing of the kind")).toBe(false);
      expect([...features.keys()]).toEqual(names);
      expect([...features.values()]).toEqual(names);
      expect([...features.entries()]).toEqual(names.map(name => [name, name]));
      const calls: unknown[] = [];
      const thisArg = {};
      features.forEach(function (this: unknown, ...args: unknown[]) {
        calls.push([this === thisArg, ...args]);
      }, thisArg);
      expect(calls).toEqual(names.map(name => [true, name, name, features]));
      expect(Object.prototype.toString.call(features.values())).toBe("[object Set Iterator]");
      expect(features.add).toBeUndefined();
    });
  });

  describe("adapters", () => {
    test("an adapter says what it is and what it has", async () => {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "low-power" });
      expect(adapter).toBeInstanceOf(g.GPUAdapter);
      expect(adapter.info).toBeInstanceOf(g.GPUAdapterInfo);
      expect(adapter.info).toBe(adapter.info);
      expect(adapter.info.description).toBeString();
      // Each is empty or a normalized identifier.
      for (const key of ["vendor", "architecture", "device"])
        expect(adapter.info[key]).toMatch(/^$|^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(adapter.info.isFallbackAdapter).toBeBoolean();
      expect(adapter.features).toBe(adapter.features);
      expect(adapter.features.has("core-features-and-limits")).toBe(true);
      expect(adapter.limits).toBe(adapter.limits);
      expect(adapter.limits.maxBindGroups).toBeGreaterThanOrEqual(4);
      expect(adapter.limits.maxBufferSize).toBeGreaterThanOrEqual(268435456);
      expect(adapter.limits.maxStorageBuffersInVertexStage).toBeNumber();
      expect(Object.keys(g.GPUSupportedLimits.prototype)).toHaveLength(36);
    });

    test("there is no adapter of a feature level that does not exist", async () => {
      expect(await navigator.gpu.requestAdapter({ featureLevel: "nothing of the kind" })).toBeNull();
      expect(await navigator.gpu.requestAdapter({ featureLevel: "compatibility" })).not.toBeNull();
      expect(await navigator.gpu.requestAdapter(null)).not.toBeNull();
    });

    test.skipIf(!isLinux).concurrent("without a driver there is no adapter, and nothing is printed", async () => {
      const result = await run(`console.log(await navigator.gpu.requestAdapter());`, {
        prologue: "",
        env: { VK_DRIVER_FILES: "/nonexistent.json", VK_ICD_FILENAMES: "/nonexistent.json" },
      });
      expect(result).toEqual({ stdout: "null\n", stderr: "", exitCode: 0 });
    });

    test("what is wrong with the options rejects the promise", async () => {
      expect(await rejection(navigator.gpu.requestAdapter({ powerPreference: "medium" }))).toBeInstanceOf(TypeError);
      expect(await rejection(navigator.gpu.requestAdapter(1))).toBeInstanceOf(TypeError);
    });

    test("an adapter makes one device", async () => {
      const adapter = await navigator.gpu.requestAdapter();
      expect(await adapter.requestDevice()).toBeInstanceOf(g.GPUDevice);
      expect((await rejection(adapter.requestDevice())).name).toBe("OperationError");
    });

    test.each([undefined, "TypeError", "OperationError"])(
      "the request that makes a device consumes the adapter, and one that fails with %s does not",
      async failure => {
        const failing = {
          TypeError: { requiredFeatures: ["nothing of the kind"] },
          OperationError: { requiredLimits: { minUniformBufferOffsetAlignment: 255 } },
        };
        const outcome = (request: Promise<any>) =>
          request.then(
            device => device.constructor.name,
            error => error.name,
          );
        // Whether or not anything waits for the request before.
        for (const isAwaited of [true, false]) {
          const adapter = await navigator.gpu.requestAdapter();
          const outcomes = [];
          for (const descriptor of [...(failure ? [failing[failure as keyof typeof failing]] : []), {}, {}]) {
            const request = outcome(adapter.requestDevice(descriptor));
            outcomes.push(isAwaited ? await request : request);
          }
          expect(await Promise.all(outcomes)).toEqual([...(failure ? [failure] : []), "GPUDevice", "OperationError"]);
        }
      },
    );

    test("the largest number that a limit can hold is a number like any other", async () => {
      for (const limit of ["maxBindGroups", "minUniformBufferOffsetAlignment"]) {
        const adapter = await navigator.gpu.requestAdapter();
        const error = await rejection(adapter.requestDevice({ requiredLimits: { [limit]: 2 ** 32 - 1 } }));
        expect([limit, error.name]).toEqual([limit, "OperationError"]);
      }
    });

    test("a device has the label, the features and the limits that were asked for", async () => {
      const adapter = await navigator.gpu.requestAdapter();
      const feature = [...adapter.features].find(name => name !== "core-features-and-limits")!;
      const made = await adapter.requestDevice({
        label: "the device",
        requiredFeatures: new Set([feature]),
        requiredLimits: { maxBindGroups: 4, maxBufferSize: undefined },
        defaultQueue: { label: "the queue" },
      });
      expect(made.label).toBe("the device");
      expect(made.queue.label).toBe("the queue");
      expect(made.queue).toBe(made.queue);
      expect(made.features.has(feature)).toBe(true);
      expect(made.limits.maxBindGroups).toBe(4);
      expect(made.adapterInfo).toBeInstanceOf(g.GPUAdapterInfo);
      expect(made.adapterInfo.vendor).toBe(adapter.info.vendor);
    });

    test("the features of an adapter are a request for them all, and its limits are a request for none", async () => {
      const adapter = await navigator.gpu.requestAdapter();
      const made = await adapter.requestDevice({ requiredFeatures: adapter.features, requiredLimits: adapter.limits });
      expect([...made.features].toSorted()).toEqual([...adapter.features].toSorted());
      // A record is made of own properties, and those are getters of the prototype.
      expect(made.limits.maxBufferSize).toBe((await newDevice()).limits.maxBufferSize);
    });

    test("a request that cannot be met is rejected, and the adapter can be asked again", async () => {
      const adapter = await navigator.gpu.requestAdapter();
      const unknownLimit = await rejection(adapter.requestDevice({ requiredLimits: { maxNothing: 1 } }));
      expect([unknownLimit.name, unknownLimit.message]).toEqual([
        "OperationError",
        'requiredLimits: "maxNothing" is not a limit',
      ]);
      expect((await rejection(adapter.requestDevice({ requiredLimits: { maxBindGroups: 2 ** 40 } }))).name).toBe(
        "OperationError",
      );
      expect(await rejection(adapter.requestDevice({ requiredLimits: { maxBindGroups: -1 } }))).toBeInstanceOf(
        TypeError,
      );
      expect(await rejection(adapter.requestDevice({ requiredFeatures: ["nothing of the kind"] }))).toBeInstanceOf(
        TypeError,
      );
      expect(await adapter.requestDevice()).toBeInstanceOf(g.GPUDevice);
    });

    test("a limit that is better than the adapter's is refused", async () => {
      const adapter = await navigator.gpu.requestAdapter();
      const maxBindGroups = adapter.limits.maxBindGroups + 1;
      expect((await rejection(adapter.requestDevice({ requiredLimits: { maxBindGroups } }))).name).toBe(
        "OperationError",
      );
      // It made no device, so it still can.
      expect(await adapter.requestDevice()).toBeInstanceOf(g.GPUDevice);
    });
  });

  describe("labels", () => {
    test("every object has the label of its descriptor, which can be assigned", () => {
      const module = device.createShaderModule({ label: "module", code: "@compute @workgroup_size(1) fn main() {}" });
      const texture = device.createTexture({ label: "texture", size: [1], format: "r8unorm", usage: 4 });
      const encoder = device.createCommandEncoder({ label: "encoder" });
      const pass = encoder.beginComputePass({ label: "pass" });
      pass.end();
      const objects = {
        buffer: device.createBuffer({ label: "buffer", size: 4, usage: GPUBufferUsage.COPY_DST }),
        texture,
        view: texture.createView({ label: "view" }),
        sampler: device.createSampler({ label: "sampler" }),
        layout: device.createBindGroupLayout({ label: "layout", entries: [] }),
        module,
        pipeline: device.createComputePipeline({ label: "pipeline", layout: "auto", compute: { module } }),
        encoder,
        pass,
        commands: encoder.finish({ label: "commands" }),
        queries: device.createQuerySet({ label: "queries", type: "occlusion", count: 1 }),
      };
      for (const [label, object] of Object.entries(objects)) {
        expect(object.label).toBe(label);
        object.label = 1;
        expect(object.label).toBe("1");
      }
      expect(device.createSampler().label).toBe("");
    });

    test("a label is a USVString", () => {
      const sampler = device.createSampler({ label: "a\ud800b" });
      expect(sampler.label).toBe("a�b");
      sampler.label = "\udc00é";
      expect(sampler.label).toBe("�é");
    });
  });

  describe("buffers", () => {
    test("a buffer says what it was made with", () => {
      const usage = GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
      const buffer = device.createBuffer({ size: 16, usage });
      expect(buffer).toBeInstanceOf(g.GPUBuffer);
      expect([buffer.size, buffer.usage, buffer.mapState]).toEqual([16, usage, "unmapped"]);
    });

    test("the members of a descriptor are converted as WebIDL says", () => {
      expect(() => device.createBuffer()).toThrow(TypeError);
      expect(() => device.createBuffer({ usage: 4 })).toThrow("GPUBufferDescriptor.size");
      expect(() => device.createBuffer({ size: -1, usage: 4 })).toThrow(TypeError);
      expect(() => device.createBuffer({ size: 2 ** 53, usage: 4 })).toThrow(TypeError);
      expect(() => device.createBuffer({ size: 4, usage: 2 ** 32 })).toThrow(TypeError);
      expect(device.createBuffer({ size: "8", usage: 4.9, mappedAtCreation: 0 }).size).toBe(8);
      const read: string[] = [];
      const descriptor = new Proxy(
        { size: 4, usage: 4 },
        { get: (target, key) => (read.push(String(key)), Reflect.get(target, key)) },
      );
      device.createBuffer(descriptor);
      // The dictionary that it inherits from comes first, then its own in lexicographical order.
      expect(read).toEqual(["label", "mappedAtCreation", "size", "usage"]);
    });

    test("what is written at creation is read back", async () => {
      const buffer = device.createBuffer({
        size: 24,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
      });
      expect(buffer.mapState).toBe("mapped");
      const range = buffer.getMappedRange();
      expect(range).toBeInstanceOf(ArrayBuffer);
      expect(range.byteLength).toBe(24);
      new Uint32Array(range).set([1, 2, 3, 4, 5, 6]);
      buffer.unmap();
      expect([buffer.mapState, range.byteLength, range.detached]).toEqual(["unmapped", 0, true]);

      const mapped = buffer.mapAsync(GPUMapMode.READ, 8);
      expect(buffer.mapState).toBe("pending");
      expect(await mapped).toBeUndefined();
      expect(buffer.mapState).toBe("mapped");
      expect([...new Uint32Array(buffer.getMappedRange(8, 4))]).toEqual([3]);
      expect([...new Uint32Array(buffer.getMappedRange(16))]).toEqual([5, 6]);
      // Before what is mapped.
      expect(thrown(() => buffer.getMappedRange(0, 4)).name).toBe("OperationError");
      buffer.unmap();
    });

    test("writeBuffer() counts elements of a typed array and bytes of anything else", async () => {
      const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const data = new Uint32Array([10, 11, 12, 13, 14]);
      device.queue.writeBuffer(buffer, 0, data, 1, 2);
      device.queue.writeBuffer(buffer, 8, data.buffer, 12, 4);
      device.queue.writeBuffer(buffer, 12, new DataView(data.buffer), 16);
      await buffer.mapAsync(GPUMapMode.READ);
      expect([...new Uint32Array(buffer.getMappedRange())]).toEqual([11, 12, 13, 14]);
      buffer.unmap();

      expect(thrown(() => device.queue.writeBuffer(buffer, 0, data, 6)).name).toBe("OperationError");
      expect(thrown(() => device.queue.writeBuffer(buffer, 0, data, 4, 2)).name).toBe("OperationError");
      expect(thrown(() => device.queue.writeBuffer(buffer, 0, new Uint8Array(3))).name).toBe("OperationError");
      expect(() => device.queue.writeBuffer(buffer, 0, [1, 2])).toThrow(TypeError);
      expect(() => device.queue.writeBuffer({}, 0, data)).toThrow(TypeError);
      device.queue.writeBuffer(buffer, 0, new Uint32Array(new SharedArrayBuffer(4)));
    });

    test("getMappedRange() refuses what is not mapped, not aligned or already returned", () => {
      const buffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.COPY_SRC, mappedAtCreation: true });
      buffer.getMappedRange(8, 8);
      const overlaps = "The range overlaps one that getMappedRange() has returned since the buffer was mapped";
      for (const [offset, size, message] of [
        [8, 8, overlaps],
        [0, 12, overlaps],
        [8, 4, overlaps],
        [12, undefined, "offset is 12, which is not a multiple of 8"],
        [4, 4, "offset is 4, which is not a multiple of 8"],
        [0, 2, "size is 2, which is not a multiple of 4"],
        [16, 64, "Bytes 16 to 80 are not all in what is mapped"],
        [64, undefined, "Bytes 64 to 64 are not all in what is mapped"],
      ] as const) {
        const error = thrown(() => buffer.getMappedRange(offset, size));
        expect([offset, size, error.name, error.message]).toEqual([offset, size, "OperationError", message]);
      }
      expect(buffer.getMappedRange(0, 8).byteLength).toBe(8);
      expect(buffer.getMappedRange(16).byteLength).toBe(16);
      expect(buffer.getMappedRange(32).byteLength).toBe(0);
      buffer.unmap();
      expect(thrown(() => buffer.getMappedRange()).message).toBe("The buffer is not mapped");
    });

    test.each(["unmap", "destroy"])("%s() detaches every range", method => {
      const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_SRC, mappedAtCreation: true });
      const ranges = [buffer.getMappedRange(0, 8), buffer.getMappedRange(8, 8)];
      const view = new Uint8Array(ranges[0]);
      buffer[method]();
      expect(ranges.map(range => [range.detached, range.byteLength])).toEqual([
        [true, 0],
        [true, 0],
      ]);
      expect(view.length).toBe(0);
      expect(buffer.mapState).toBe("unmapped");
      buffer[method]();
    });

    test("destroying the device detaches the ranges of its buffers", async () => {
      const other = await newDevice();
      const buffers = [1, 2].map(() =>
        other.createBuffer({ size: 8, usage: GPUBufferUsage.COPY_SRC, mappedAtCreation: true }),
      );
      const ranges = buffers.map(buffer => buffer.getMappedRange());
      other.destroy();
      expect(ranges.map(range => range.detached)).toEqual([true, true]);
    });

    test("a range outlives the objects that it came from", async () => {
      const ranges: ArrayBuffer[] = [];
      await (async () => {
        const other = await newDevice();
        for (let i = 0; i < 8; i++)
          ranges.push(
            other.createBuffer({ size: 4096, usage: GPUBufferUsage.COPY_SRC, mappedAtCreation: true }).getMappedRange(),
          );
      })();
      Bun.gc(true);
      for (const [i, range] of ranges.entries()) {
        expect(range.byteLength).toBe(4096);
        new Uint8Array(range).fill(i + 1);
      }
      expect(ranges.map(range => new Uint8Array(range)[4095])).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    test("a range is cloned, and only its buffer detaches it", async () => {
      const buffer = device.createBuffer({ size: 8, usage: GPUBufferUsage.COPY_SRC, mappedAtCreation: true });
      const range = buffer.getMappedRange();
      new Uint8Array(range).fill(7);
      const { port1, port2 } = new MessageChannel();
      try {
        expect(() => structuredClone(range, { transfer: [range] })).toThrow(TypeError);
        expect(() => port1.postMessage(range, [range])).toThrow(TypeError);
        expect(Reflect.ownKeys(range)).toEqual([]);
        const received = new Promise<MessageEvent>(resolve => (port2.onmessage = resolve));
        port1.postMessage(range);
        const copies = [structuredClone(range), (await received).data, range.transfer()];
        expect([range.detached, range.byteLength]).toEqual([false, 8]);
        buffer.unmap();
        expect(range.detached).toBe(true);
        for (const copy of copies) expect([...new Uint8Array(copy)]).toEqual([7, 7, 7, 7, 7, 7, 7, 7]);
      } finally {
        port1.close();
      }
    });

    test.each(["unmap", "destroy", "destroy the device"])(
      "%s waits for what reads a range on another thread",
      async how => {
        using dir = tempDir("webgpu-mapped-range", {});
        const other = await newDevice();
        const buffer = other.createBuffer({ size: 1 << 20, usage: GPUBufferUsage.COPY_SRC, mappedAtCreation: true });
        const free = () => (how === "destroy the device" ? other.destroy() : buffer[how]());
        const range = buffer.getMappedRange();
        new Uint8Array(range).fill(7);
        // The write cannot say that it is done before this turn of the event loop ends.
        const written = fs.writeFile(join(String(dir), "range"), new Uint8Array(range));
        const error = thrown(free);
        expect([error.name, error.message]).toEqual([
          "InvalidStateError",
          `${how === "unmap" ? "unmap" : "destroy"}() frees the memory that getMappedRange() returned, which an operation that has not finished is using. Await that operation first.`,
        ]);
        expect([range.detached, buffer.mapState]).toEqual([false, "mapped"]);
        await written;
        free();
        expect([range.detached, buffer.mapState]).toEqual([true, "unmapped"]);
        expect(Buffer.alloc(1 << 20, 7).equals(await fs.readFile(join(String(dir), "range")))).toBe(true);
      },
    );

    describe("a mapAsync() that fails", () => {
      const mappable = (on = device) => on.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ });

      /** How: with what, before or after the microtask that follows the call, and with a validation error or without. */
      async function failure(buffer: any, afterTheCall = () => {}, on = device) {
        on.pushErrorScope("validation");
        const mapped = buffer.mapAsync(GPUMapMode.READ);
        const scope = on.popErrorScope();
        let isRejected = false;
        let when = "";
        mapped.catch(() => (isRejected = true));
        queueMicrotask(() => (when = isRejected ? "at once" : "later"));
        afterTheCall();
        const error = await rejection(mapped);
        expect(error).toBeInstanceOf(Error);
        expect(error.stack).toBeString();
        return [error.name, when, (await scope) === null ? "no error" : "validation error"];
      }

      test("because the buffer is being mapped", async () => {
        const buffer = mappable();
        const first = buffer.mapAsync(GPUMapMode.READ, 0, 8);
        expect(await failure(buffer)).toEqual(["OperationError", "at once", "validation error"]);
        await first;
        expect(buffer.mapState).toBe("mapped");
      });

      test("because the buffer is mapped", async () => {
        const buffer = mappable();
        await buffer.mapAsync(GPUMapMode.READ);
        expect(await failure(buffer)).toEqual(["OperationError", "at once", "validation error"]);
        buffer.unmap();
        await buffer.mapAsync(GPUMapMode.READ);
        const atCreation = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ, mappedAtCreation: true });
        expect(await failure(atCreation)).toEqual(["OperationError", "at once", "validation error"]);
      });

      test.each(["unmap", "destroy"])("because %s() gave up on it", async method => {
        const buffer = mappable();
        const states = [buffer.mapState];
        const given = failure(buffer, () => {
          states.push(buffer.mapState);
          buffer[method]();
          states.push(buffer.mapState);
        });
        expect(await given).toEqual(["AbortError", "later", "no error"]);
        expect(states).toEqual(["unmapped", "pending", "unmapped"]);
      });

      test("because the buffer is destroyed, or cannot be mapped", async () => {
        const destroyed = mappable();
        destroyed.destroy();
        expect(await failure(destroyed)).toEqual(["OperationError", "later", "validation error"]);
        const storage = device.createBuffer({ size: 8, usage: GPUBufferUsage.STORAGE });
        expect(await failure(storage)).toEqual(["OperationError", "later", "validation error"]);
        // It is pending until JavaScript hears, so giving up on it comes first.
        expect(await failure(storage, () => storage.unmap())).toEqual(["AbortError", "later", "validation error"]);
        expect(await rejection(storage.mapAsync(-1))).toBeInstanceOf(TypeError);
      });

      test("because the device is destroyed", async () => {
        const other = await newDevice();
        const buffer = mappable(other);
        other.destroy();
        expect(await failure(buffer, undefined, other)).toEqual(["AbortError", "later", "no error"]);
        await other.lost;
        expect(await failure(buffer, undefined, other)).toEqual(["AbortError", "later", "no error"]);
      });

      test("settles no other promise, however many there are", async () => {
        const buffers = Array.from({ length: 8 }, () => mappable());
        // Each is given up on at once, and the next begins before Dawn has answered for it.
        const abandoned = buffers.map(buffer => {
          const mapped = buffer.mapAsync(GPUMapMode.READ);
          buffer.unmap();
          return rejection(mapped);
        });
        const kept = buffers.map(buffer => buffer.mapAsync(GPUMapMode.READ));
        expect((await Promise.all(abandoned)).map(error => error.name)).toEqual(buffers.map(() => "AbortError"));
        expect(await Promise.all(kept)).toEqual(buffers.map(() => undefined));
        expect(buffers.map(buffer => buffer.mapState)).toEqual(buffers.map(() => "mapped"));
      });
    });

    test("a buffer that is not valid is still mapped at creation", async () => {
      let buffer: any;
      const descriptor = { mappedAtCreation: true, size: 16, usage: 0xffff_ffff };
      const error = await validationErrorOf(device, () => void (buffer = device.createBuffer(descriptor)));
      expect(error).toBeInstanceOf(g.GPUValidationError);
      expect([buffer.mapState, buffer.getMappedRange().byteLength]).toEqual(["mapped", 16]);
    });

    test("the collector hears how large buffers and textures are", () => {
      // What a collection finds that the objects it visits hold.
      const extraMemorySize = () => (Bun.gc(true), heapStats().extraMemorySize);
      const before = extraMemorySize();
      const held = [
        device.createBuffer({ size: 32 << 20, usage: GPUBufferUsage.COPY_DST }),
        device.createTexture({ size: [2048, 2048, 2], format: "rgba8unorm", usage: GPUTextureUsage.COPY_DST }),
      ];
      expect(extraMemorySize() - before).toBeGreaterThanOrEqual(64 << 20);
      for (const object of held) object.destroy();
    });

    test("buffers that are dropped are collected", async () => {
      const count = () => heapStats().objectTypeCounts.GPUBuffer ?? 0;
      (() => {
        for (let i = 0; i < 200; i++) device.createBuffer({ size: 1024, usage: GPUBufferUsage.COPY_DST });
      })();
      Bun.gc(true);
      expect(count()).toBeLessThan(100);
    });
  });

  describe("textures", () => {
    test("a texture says what it was made with", () => {
      const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;
      const texture = device.createTexture({
        size: { width: 8, height: 4, depthOrArrayLayers: 2 },
        mipLevelCount: 3,
        format: "rgba8unorm",
        usage,
        viewFormats: ["rgba8unorm-srgb"],
      });
      expect({
        width: texture.width,
        height: texture.height,
        depthOrArrayLayers: texture.depthOrArrayLayers,
        mipLevelCount: texture.mipLevelCount,
        sampleCount: texture.sampleCount,
        dimension: texture.dimension,
        format: texture.format,
        usage: texture.usage,
        textureBindingViewDimension: texture.textureBindingViewDimension,
      }).toEqual({
        width: 8,
        height: 4,
        depthOrArrayLayers: 2,
        mipLevelCount: 3,
        sampleCount: 1,
        dimension: "2d",
        format: "rgba8unorm",
        usage,
        textureBindingViewDimension: undefined,
      });
      expect(texture.createView()).toBeInstanceOf(g.GPUTextureView);
      expect(texture.createView({ format: "rgba8unorm-srgb", dimension: "2d-array", baseMipLevel: 1 })).toBeInstanceOf(
        g.GPUTextureView,
      );
      texture.destroy();
    });

    test("an extent is a dictionary, or a sequence of 1 to 3", () => {
      const sizeOf = (size: unknown) => {
        const texture = device.createTexture({ size, format: "r8unorm", usage: 4 });
        return [texture.width, texture.height, texture.depthOrArrayLayers];
      };
      expect(sizeOf([2])).toEqual([2, 1, 1]);
      expect(sizeOf([2, 3])).toEqual([2, 3, 1]);
      expect(sizeOf(new Uint16Array([2, 3, 4]))).toEqual([2, 3, 4]);
      expect(sizeOf(new Set([5]))).toEqual([5, 1, 1]);
      expect(sizeOf({ width: 6 })).toEqual([6, 1, 1]);
      for (const size of [[], [1, 1, 1, 1], {}, 1, [-1], ["x"]]) expect(() => sizeOf(size)).toThrow(TypeError);
    });

    test("a format or a query type whose feature the device lacks is a TypeError", async () => {
      const plain = await newDevice();
      const usage = GPUTextureUsage.TEXTURE_BINDING;
      expect(() => plain.createTexture({ size: [4, 4], format: "bc1-rgba-unorm", usage })).toThrow(
        '"bc1-rgba-unorm" takes the feature "texture-compression-bc", which the device was not requested with',
      );
      expect(() =>
        plain.createTexture({ size: [4, 4], format: "rgba8unorm", usage, viewFormats: ["astc-4x4-unorm"] }),
      ).toThrow(TypeError);
      expect(() => plain.createTexture({ size: [4, 4], format: "nothing", usage })).toThrow(TypeError);
      expect(() => plain.createQuerySet({ type: "timestamp", count: 1 })).toThrow(TypeError);
      expect(() => plain.createRenderBundleEncoder({ colorFormats: [null, "etc2-rgb8unorm"] })).toThrow(TypeError);
      expect(() =>
        plain.createBindGroupLayout({
          entries: [{ binding: 0, visibility: 4, storageTexture: { format: "depth32float-stencil8" } }],
        }),
      ).toThrow(TypeError);
    });

    test("a swizzle is 4 of r, g, b, a, 0 and 1", () => {
      const texture = device.createTexture({ size: [1], format: "rgba8unorm", usage: 4 });
      expect(texture.createView({ swizzle: "rgba" })).toBeInstanceOf(g.GPUTextureView);
      for (const swizzle of ["rgb", "rgbax", "rgbx", ""])
        expect(() => texture.createView({ swizzle })).toThrow(TypeError);
    });

    test("a sampler takes floats, and clamps its anisotropy", async () => {
      const linear = { magFilter: "linear", minFilter: "linear", mipmapFilter: "linear" };
      expect(
        await validationErrorOf(device, () =>
          device.createSampler({ ...linear, lodMinClamp: 1.5, lodMaxClamp: "2", maxAnisotropy: 1e9 }),
        ),
      ).toBeNull();
      expect(() => device.createSampler({ lodMinClamp: NaN })).toThrow(TypeError);
      expect(() => device.createSampler({ lodMaxClamp: Infinity })).toThrow(TypeError);
      expect(() => device.createSampler({ magFilter: "cubic" })).toThrow(TypeError);
      expect(await validationErrorOf(device, () => device.createSampler({ lodMinClamp: -1 }))).toBeInstanceOf(
        g.GPUValidationError,
      );
    });

    test("a query set says what it was made with", () => {
      const queries = device.createQuerySet({ type: "occlusion", count: 3 });
      expect([queries.type, queries.count]).toEqual(["occlusion", 3]);
      queries.destroy();
    });
  });

  describe("errors", () => {
    const invalidBuffer = (on = device) =>
      on.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.STORAGE });

    test("an error scope catches the first error of its kind", async () => {
      const error = await validationErrorOf(device, invalidBuffer);
      expect(error).toBeInstanceOf(g.GPUValidationError);
      expect(error).toBeInstanceOf(g.GPUError);
      expect(error).not.toBeInstanceOf(Error);
      expect(error.message).toContain("MapRead");
      expect(await validationErrorOf(device, () => {})).toBeNull();
    });

    test("scopes nest, and each catches what its filter says", async () => {
      device.pushErrorScope("validation");
      device.pushErrorScope("out-of-memory");
      invalidBuffer();
      expect(await device.popErrorScope()).toBeNull();
      expect(await device.popErrorScope()).toBeInstanceOf(g.GPUValidationError);
      expect(() => device.pushErrorScope("nothing")).toThrow(TypeError);
    });

    test("there is nothing to pop without a scope", async () => {
      expect((await rejection(device.popErrorScope())).name).toBe("OperationError");
    });

    test("an error that no scope catches is an event", async () => {
      const other = await newDevice();
      expect(other).toBeInstanceOf(EventTarget);
      expect(other.onuncapturederror).toBeNull();
      const { promise, resolve } = Promise.withResolvers<any>();
      const order: string[] = [];
      other.addEventListener("uncapturederror", () => order.push("listener"));
      other.onuncapturederror = function (this: unknown, event: any) {
        order.push("handler");
        event.preventDefault();
        resolve({ event, receiver: this });
      };
      invalidBuffer(other);
      // Not in the middle of the call that made the error.
      expect(order).toEqual([]);
      const { event, receiver } = await promise;
      expect(order).toEqual(["listener", "handler"]);
      expect(receiver).toBe(other);
      expect(event).toBeInstanceOf(g.GPUUncapturedErrorEvent);
      expect(event).toBeInstanceOf(Event);
      expect([event.type, event.target === other, event.isTrusted, event.cancelable, event.bubbles]).toEqual([
        "uncapturederror",
        true,
        true,
        true,
        false,
      ]);
      expect(event.error).toBeInstanceOf(g.GPUValidationError);
      expect(event.error).toBe(event.error);
    });

    test.concurrent("an error that nothing handles is a warning, and the process waits to print it", async () => {
      const { stderr, ...result } = await run(`
        const device = await (await navigator.gpu.requestAdapter()).requestDevice();
        device.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.STORAGE });
        console.log("done");
      `);
      expect(stderr).toStartWith("warn: Uncaptured GPUValidationError: Buffer usages");
      expect(result).toEqual({ stdout: "done\n", exitCode: 0 });
    });

    test.concurrent("preventDefault() silences the warning", async () => {
      const result = await run(`
        const device = await (await navigator.gpu.requestAdapter()).requestDevice();
        device.addEventListener("uncapturederror", event => {
          event.preventDefault();
          console.log(event.error.constructor.name);
        });
        device.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.STORAGE });
      `);
      expect(result).toEqual({ stdout: "GPUValidationError\n", stderr: "", exitCode: 0 });
    });

    test("the errors and the event can be constructed", () => {
      for (const name of ["GPUValidationError", "GPUOutOfMemoryError", "GPUInternalError"]) {
        const error = new g[name]("the message");
        expect(error).toBeInstanceOf(g.GPUError);
        expect(Object.getPrototypeOf(g[name])).toBe(g.GPUError);
        expect(error.message).toBe("the message");
        expect(() => new g[name]()).toThrow(TypeError);
        expect(() => g[name]("the message")).toThrow(TypeError);
      }
      const error = new g.GPUInternalError("inside");
      const event = new g.GPUUncapturedErrorEvent("anything", { error, cancelable: true });
      expect([event.type, event.error === error, event.cancelable, event.isTrusted]).toEqual([
        "anything",
        true,
        true,
        false,
      ]);
      expect(() => new g.GPUUncapturedErrorEvent("anything")).toThrow(TypeError);
      expect(() => new g.GPUUncapturedErrorEvent("anything", {})).toThrow(TypeError);
      expect(() => new g.GPUUncapturedErrorEvent("anything", { error: new Error() })).toThrow(
        "GPUUncapturedErrorEventInit.error must be an instance of GPUError",
      );

      const pipelineError = new g.GPUPipelineError("the message", { reason: "internal" });
      expect(pipelineError).toBeInstanceOf(DOMException);
      expect([pipelineError.name, pipelineError.message, pipelineError.reason, pipelineError.code]).toEqual([
        "GPUPipelineError",
        "the message",
        "internal",
        0,
      ]);
      expect(new g.GPUPipelineError(undefined, { reason: "validation" }).message).toBe("");
      expect(() => new g.GPUPipelineError("the message", { reason: "nothing" })).toThrow(TypeError);
      expect(() => new g.GPUPipelineError("the message")).toThrow(TypeError);
    });

    test("a device that is destroyed is lost", async () => {
      const other = await newDevice();
      const lost = other.lost;
      expect(lost).toBeInstanceOf(Promise);
      expect(other.lost).toBe(lost);
      other.destroy();
      const info = await lost;
      expect(info).toBeInstanceOf(g.GPUDeviceLostInfo);
      expect([info.reason, info.message]).toEqual(["destroyed", "Device was destroyed."]);
      other.destroy();
      // Asked for after the fact.
      const another = await newDevice();
      another.destroy();
      expect((await another.lost).reason).toBe("destroyed");
    });

    test("a device lasts as long as anything that is made of it", async () => {
      const count = () => (Bun.gc(true), heapStats().objectTypeCounts.GPUDevice ?? 0);
      const before = count();
      const made = await (async () => {
        const other = await newDevice();
        const module = other.createShaderModule({ code: "@compute @workgroup_size(1) fn main() {}" });
        const pipeline = other.createComputePipelineAsync({ layout: "auto", compute: { module } });
        return { queue: other.queue, pending: [pipeline] };
      })();
      // The `GPUDevice` goes, and what it stood for does not. In a build that is not optimized, the frame of the
      // microtask that runs this still has the promise of the device in it.
      while (count() > before) await new Promise(resolve => setImmediate(resolve));
      expect(webgpuIsDeviceLost(made.queue)).toBe(false);
      expect(await made.pending[0]).toBeInstanceOf(g.GPUComputePipeline);
    });

    test("what a lost device is asked for fails without throwing", async () => {
      const other = await newDevice();
      const buffer = other.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ });
      other.destroy();
      expect(other.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST })).toBeInstanceOf(g.GPUBuffer);
      expect(["AbortError", "OperationError"]).toContain((await rejection(buffer.mapAsync(GPUMapMode.READ))).name);
      await other.queue.onSubmittedWorkDone();
    });
  });

  describe("shaders and pipelines", () => {
    const code = `
      override scale: f32 = 1.0;
      @group(0) @binding(0) var<storage, read_write> data: array<f32>;
      @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) { data[id.x] *= scale; }
      @compute @workgroup_size(1) fn other() {}`;

    test("what is wrong with a shader is in its compilation info", async () => {
      const source = "é\nfn main( {}";
      let module: any;
      expect(
        await validationErrorOf(device, () => void (module = device.createShaderModule({ code: source }))),
      ).toBeInstanceOf(g.GPUValidationError);
      const info = await module.getCompilationInfo();
      expect(info).toBeInstanceOf(g.GPUCompilationInfo);
      expect(info.messages).toBe(info.messages);
      expect(Object.isFrozen(info.messages)).toBe(true);
      expect(info.messages).toHaveLength(1);
      const [message] = info.messages;
      expect(message).toBeInstanceOf(g.GPUCompilationMessage);
      expect({
        type: message.type,
        lineNum: message.lineNum,
        linePos: message.linePos,
        offset: message.offset,
      }).toEqual({
        type: "error",
        lineNum: 1,
        linePos: 1,
        offset: 0,
      });
      expect(message.message).toBeString();
      expect(message.length).toBeNumber();
    });

    test("positions in a message count UTF-16 code units", async () => {
      let module: any;
      await validationErrorOf(device, () => void (module = device.createShaderModule({ code: "/* é😀 */ nothing" })));
      const [message] = (await module.getCompilationInfo()).messages;
      expect([message.lineNum, message.linePos, message.offset]).toEqual([1, 11, 10]);
    });

    test("a shader that is right has nothing to say", async () => {
      const module = device.createShaderModule({
        code,
        compilationHints: [{ entryPoint: "main", layout: "auto" }, { entryPoint: "other" }],
      });
      expect((await module.getCompilationInfo()).messages).toEqual([]);
      expect(() => device.createShaderModule({})).toThrow(TypeError);
      expect(() => device.createShaderModule({ code, compilationHints: [{}] })).toThrow(TypeError);
    });

    test("a pipeline has the layouts that its shader implies", async () => {
      const module = device.createShaderModule({ code });
      const descriptor = { layout: "auto", compute: { module, entryPoint: "main", constants: { scale: 2 } } };
      for (const pipeline of [
        device.createComputePipeline(descriptor),
        await device.createComputePipelineAsync(descriptor),
      ]) {
        expect(pipeline).toBeInstanceOf(g.GPUComputePipeline);
        const layout = pipeline.getBindGroupLayout(0);
        expect(layout).toBeInstanceOf(g.GPUBindGroupLayout);
        expect(pipeline.getBindGroupLayout(0)).not.toBe(layout);
      }
    });

    test("a pipeline that cannot be made rejects with a GPUPipelineError", async () => {
      const module = device.createShaderModule({ code });
      const error = await rejection(
        device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "nothing" } }),
      );
      expect(error).toBeInstanceOf(g.GPUPipelineError);
      expect(error).toBeInstanceOf(DOMException);
      expect([error.name, error.reason]).toEqual(["GPUPipelineError", "validation"]);
      expect(error.message).toContain("nothing");
      // Two entry points, and none is named.
      expect((await rejection(device.createComputePipelineAsync({ layout: "auto", compute: { module } }))).reason).toBe(
        "validation",
      );
    });

    test("what is wrong with a descriptor throws, or rejects", async () => {
      const module = device.createShaderModule({ code });
      for (const descriptor of [
        {},
        { layout: "auto" },
        { layout: "manual", compute: { module } },
        { layout: {}, compute: { module } },
        { layout: "auto", compute: { module: {} } },
        { layout: "auto", compute: { module, constants: { scale: NaN } } },
        { layout: "auto", compute: { module, constants: 1 } },
      ]) {
        expect(() => device.createComputePipeline(descriptor)).toThrow(TypeError);
        expect(await rejection(device.createComputePipelineAsync(descriptor))).toBeInstanceOf(TypeError);
      }
    });

    test("a bind group takes every kind of resource", async () => {
      const buffer = device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.UNIFORM });
      const texture = device.createTexture({ size: [1], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING });
      const layout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {} },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, sampler: {} },
          { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: {} },
          { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: {} },
        ],
      });
      const error = await validationErrorOf(device, () => {
        const group = device.createBindGroup({
          layout,
          entries: [
            { binding: 0, resource: buffer },
            { binding: 1, resource: { buffer, offset: 0, size: 64 } },
            { binding: 2, resource: device.createSampler() },
            { binding: 3, resource: texture },
            { binding: 4, resource: texture.createView() },
          ],
        });
        expect(group).toBeInstanceOf(g.GPUBindGroup);
        expect(device.createPipelineLayout({ bindGroupLayouts: [layout, null, layout] })).toBeInstanceOf(
          g.GPUPipelineLayout,
        );
      });
      expect(error).toBeNull();
      expect(() => device.createBindGroup({ layout, entries: [{ binding: 0, resource: {} }] })).toThrow(TypeError);
      expect(() => device.createBindGroup({ layout, entries: [{ binding: 0, resource: layout }] })).toThrow(TypeError);
      expect(() => device.createBindGroup({ layout: buffer, entries: [] })).toThrow(TypeError);
    });

    test("a descriptor holds its objects while the rest of it is read", async () => {
      const error = await validationErrorOf(device, () =>
        device.createBindGroup({
          get layout() {
            return device.createBindGroupLayout({
              entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }],
            });
          },
          // Read before `layout`, which comes later in the alphabet.
          get entries() {
            return [
              {
                binding: 0,
                get resource() {
                  return device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE });
                },
              },
            ];
          },
          get label() {
            Bun.gc(true);
            return "";
          },
        }),
      );
      expect(error).toBeNull();
    });
  });

  describe("commands", () => {
    test("every command of a compute pass is encoded", async () => {
      const module = device.createShaderModule({
        code: `@group(0) @binding(0) var<storage, read_write> data: array<u32>;
               @compute @workgroup_size(1) fn main() { data[0] = 1; }`,
      });
      const layout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage", hasDynamicOffset: true } },
        ],
      });
      const pipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        compute: { module },
      });
      const buffer = device.createBuffer({
        size: 1024,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      });
      const indirect = device.createBuffer({ size: 16, usage: GPUBufferUsage.INDIRECT });
      const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer, size: 256 } }] });
      const error = await validationErrorOf(device, () => {
        const encoder = device.createCommandEncoder();
        encoder.pushDebugGroup("group");
        encoder.insertDebugMarker("marker");
        encoder.clearBuffer(buffer);
        encoder.clearBuffer(buffer, 4, 4);
        const pass = encoder.beginComputePass();
        expect(pass).toBeInstanceOf(g.GPUComputePassEncoder);
        pass.pushDebugGroup("group");
        pass.insertDebugMarker("marker");
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group, [256]);
        pass.setBindGroup(0, group, new Uint32Array([0, 256, 512]), 1, 1);
        pass.setBindGroup(0, group, new Set([512]));
        pass.dispatchWorkgroups(1);
        pass.dispatchWorkgroups(1, 2, 3);
        pass.dispatchWorkgroupsIndirect(indirect, 4);
        pass.setBindGroup(0, null);
        pass.popDebugGroup();
        pass.end();
        encoder.popDebugGroup();
        const other = device.createBuffer({ size: 1024, usage: GPUBufferUsage.COPY_DST });
        encoder.copyBufferToBuffer(buffer, other);
        encoder.copyBufferToBuffer(buffer, other, 16);
        encoder.copyBufferToBuffer(buffer, 16, other, 32, 64);
        encoder.copyBufferToBuffer(buffer, 16, other, 16);
        const commands = encoder.finish();
        expect(commands).toBeInstanceOf(g.GPUCommandBuffer);
        device.queue.submit([commands]);
        device.queue.submit(new Set());
      });
      expect(error).toBeNull();
      await device.queue.onSubmittedWorkDone();
    });

    test("the data of dynamic offsets is a Uint32Array that holds them", () => {
      const pass = device.createCommandEncoder().beginComputePass();
      expect(() => pass.setBindGroup(0, null, new Uint32Array(2), 1, 2)).toThrow(RangeError);
      expect(() => pass.setBindGroup(0, null, new Uint32Array(2), 3, 0)).toThrow(RangeError);
      expect(() => pass.setBindGroup(0, null, new Int32Array(2), 0, 1)).toThrow(TypeError);
      expect(() => pass.setBindGroup(0, null, new Uint32Array(2), 0)).toThrow(TypeError);
      expect(() => pass.setBindGroup(0, null, [-1])).toThrow(TypeError);
      expect(() => pass.setBindGroup(0, {})).toThrow(TypeError);
      pass.end();
    });

    test("every command of a render pass and of a bundle is encoded", async () => {
      const module = device.createShaderModule({
        code: `@vertex fn vs(@location(0) p: vec2f) -> @builtin(position) vec4f { return vec4f(p, 0, 1); }
               @fragment fn fs() -> @location(0) vec4f { return vec4f(1); }`,
      });
      const descriptor = {
        layout: "auto",
        vertex: {
          module,
          buffers: [null, { arrayStride: 8, attributes: [{ format: "float32x2", offset: 0, shaderLocation: 0 }] }],
        },
        primitive: { topology: "triangle-strip", stripIndexFormat: "uint16", cullMode: "back" },
        depthStencil: { format: "depth24plus-stencil8", depthWriteEnabled: true, depthCompare: "less" },
        multisample: {},
        fragment: {
          module,
          targets: [
            {
              format: "rgba8unorm",
              blend: { color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" }, alpha: {} },
              writeMask: GPUColorWrite.ALL,
            },
            null,
          ],
        },
      };
      const usage = GPUTextureUsage.RENDER_ATTACHMENT;
      const color = device.createTexture({ size: [4, 4], format: "rgba8unorm", usage });
      const depth = device.createTexture({ size: [4, 4], format: "depth24plus-stencil8", usage });
      const buffer = device.createBuffer({
        size: 256,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.INDEX | GPUBufferUsage.INDIRECT,
      });
      const queries = device.createQuerySet({ type: "occlusion", count: 1 });
      const error = await validationErrorOf(device, async () => {
        const pipeline = device.createRenderPipeline(descriptor);
        expect(pipeline).toBeInstanceOf(g.GPURenderPipeline);
        const draw = (encoder: any) => {
          encoder.setPipeline(pipeline);
          encoder.setVertexBuffer(1, buffer);
          encoder.setVertexBuffer(1, buffer, 8, 64);
          encoder.setVertexBuffer(0, null);
          encoder.setIndexBuffer(buffer, "uint16");
          encoder.setIndexBuffer(buffer, "uint16", 2, 32);
          encoder.draw(3);
          encoder.draw(3, 1, 0, 0);
          encoder.drawIndexed(3);
          encoder.drawIndexed(3, 1, 0, -1, 0);
          encoder.drawIndirect(buffer, 0);
          encoder.drawIndexedIndirect(buffer, 32);
        };
        const bundleEncoder = device.createRenderBundleEncoder({
          colorFormats: ["rgba8unorm", null],
          depthStencilFormat: "depth24plus-stencil8",
        });
        draw(bundleEncoder);
        const bundle = bundleEncoder.finish({ label: "bundle" });
        expect(bundle).toBeInstanceOf(g.GPURenderBundle);

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            { view: color, clearValue: { r: 0, g: 0.5, b: 1, a: 1 }, loadOp: "clear", storeOp: "store" },
            null,
          ],
          depthStencilAttachment: {
            view: depth.createView(),
            depthClearValue: 1,
            depthLoadOp: "clear",
            depthStoreOp: "store",
            stencilLoadOp: "clear",
            stencilStoreOp: "discard",
          },
          occlusionQuerySet: queries,
        });
        expect(pass).toBeInstanceOf(g.GPURenderPassEncoder);
        pass.setViewport(0, 0, 4, 4, 0, 1);
        pass.setScissorRect(0, 0, 2, 2);
        pass.setBlendConstant([0, 0, 0, 1]);
        pass.setBlendConstant({ r: 1, g: 1, b: 1, a: 1 });
        pass.setStencilReference(1);
        pass.beginOcclusionQuery(0);
        draw(pass);
        pass.endOcclusionQuery();
        pass.executeBundles([bundle]);
        pass.end();
        device.queue.submit([encoder.finish()]);
      });
      expect(error).toBeNull();
      expect(await device.createRenderPipelineAsync(descriptor)).toBeInstanceOf(g.GPURenderPipeline);
    });

    test("a color is a dictionary, or a sequence of 4", () => {
      const view = device.createTexture({ size: [1], format: "rgba8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT });
      const begin = (clearValue: unknown) =>
        device
          .createCommandEncoder()
          .beginRenderPass({ colorAttachments: [{ view, clearValue, loadOp: "clear", storeOp: "store" }] })
          .end();
      begin([0, 0, 0, 0]);
      begin(new Float32Array(4));
      begin({ r: 0, g: 0, b: 0, a: 0 });
      begin(undefined);
      for (const color of [[0, 0, 0], [0, 0, 0, 0, 0], { r: 0, g: 0, b: 0 }, [0, 0, 0, NaN], 1])
        expect(() => begin(color)).toThrow(TypeError);
    });

    test("texels are copied to and from textures", async () => {
      const usage = GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
      const [a, b] = [1, 2].map(() => device.createTexture({ size: [4, 4], format: "rgba8unorm", usage }));
      const buffer = device.createBuffer({ size: 1024, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
      const error = await validationErrorOf(device, () => {
        device.queue.writeTexture({ texture: a }, new Uint8Array(64), { bytesPerRow: 16 }, [4, 4]);
        device.queue.writeTexture(
          { texture: a, origin: [1, 1], mipLevel: 0, aspect: "all" },
          new Uint8Array(64).buffer,
          { offset: 16, bytesPerRow: 16, rowsPerImage: 2 },
          { width: 2, height: 2 },
        );
        const encoder = device.createCommandEncoder();
        encoder.copyBufferToTexture({ buffer, bytesPerRow: 256 }, { texture: a }, [4, 4]);
        encoder.copyTextureToTexture({ texture: a, origin: { x: 1 } }, { texture: b }, [2, 2, 1]);
        encoder.copyTextureToBuffer({ texture: b }, { buffer, offset: 256, bytesPerRow: 256 }, { width: 2 });
        device.queue.submit([encoder.finish()]);
      });
      expect(error).toBeNull();
      const encoder = device.createCommandEncoder();
      expect(() => encoder.copyTextureToTexture({ texture: a, origin: [0, 0, 0, 0] }, { texture: b }, [1])).toThrow(
        TypeError,
      );
      expect(() => encoder.copyTextureToTexture({ texture: a }, { texture: buffer }, [1])).toThrow(TypeError);
      expect(() => encoder.copyTextureToTexture({ texture: a }, { texture: b }, [])).toThrow(TypeError);
    });

    test("a command buffer is submitted once", async () => {
      const commands = device.createCommandEncoder().finish();
      device.queue.submit([commands]);
      expect(await validationErrorOf(device, () => device.queue.submit([commands]))).toBeInstanceOf(
        g.GPUValidationError,
      );
      expect(() => device.queue.submit([{}])).toThrow(TypeError);
      expect(() => device.queue.submit(commands)).toThrow(TypeError);
    });
  });

  describe("the process", () => {
    test.concurrent("stays for a promise that is pending, and not for a device", async () => {
      const { stdout, ...result } = await run(`
        const device = await (await navigator.gpu.requestAdapter()).requestDevice();
        device.lost.then(() => console.log("lost"));
        const buffer = device.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ });
        buffer.mapAsync(GPUMapMode.READ).then(() => console.log("mapped"));
        device.queue.onSubmittedWorkDone().then(() => console.log("done"));
      `);
      expect(stdout.split("\n").toSorted()).toEqual(["", "done", "mapped"]);
      expect(result).toEqual({ stderr: "", exitCode: 0 });
    });

    test.concurrent("a worker has a navigator.gpu of its own", async () => {
      const result = await run(`
        const worker = new Worker(URL.createObjectURL(new Blob([\`
          const device = await (await navigator.gpu.requestAdapter()).requestDevice();
          const buffer = device.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
          device.queue.writeBuffer(buffer, 0, new Uint32Array([42]));
          await buffer.mapAsync(GPUMapMode.READ);
          postMessage(new Uint32Array(buffer.getMappedRange())[0]);
        \`], { type: "text/javascript" })));
        const { data } = await new Promise(resolve => (worker.onmessage = resolve));
        console.log(data);
        await worker.terminate();
      `);
      expect(result).toEqual({ stdout: "42\n", stderr: "", exitCode: 0 });
    });

    test.concurrent("a worker can be terminated while it waits for the GPU", async () => {
      const result = await run(`
        const worker = new Worker(URL.createObjectURL(new Blob([\`
          const device = await (await navigator.gpu.requestAdapter()).requestDevice();
          const range = device.createBuffer({ size: 8, usage: GPUBufferUsage.COPY_SRC, mappedAtCreation: true }).getMappedRange();
          globalThis.kept = [device, range];
          postMessage("ready");
          for (;;) {
            const buffer = device.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ });
            await buffer.mapAsync(GPUMapMode.READ);
          }
        \`], { type: "text/javascript" })));
        await new Promise(resolve => (worker.onmessage = resolve));
        await worker.terminate();
        console.log("terminated");
      `);
      expect(result).toEqual({ stdout: "terminated\n", stderr: "", exitCode: 0 });
    });

    test.concurrent("a worker can exit while its devices have errors to report", async () => {
      const result = await run(`
        const worker = new Worker(URL.createObjectURL(new Blob([\`
          for (let i = 0; i < 3; i++) {
            const device = await (await navigator.gpu.requestAdapter()).requestDevice();
            device.onuncapturederror = () => {
              postMessage("error");
              process.exit(0);
            };
            (globalThis.devices ??= []).push(device);
          }
          for (const device of devices) device.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.STORAGE });
        \`], { type: "text/javascript" })));
        let errors = 0;
        worker.onmessage = () => errors++;
        const { code } = await new Promise(resolve => worker.addEventListener("close", resolve));
        console.log(errors, code);
      `);
      expect(result).toEqual({ stdout: "1 0\n", stderr: "", exitCode: 0 });
    });
  });
});

describe.skipIf(deviceOfGPU === null)("WebGPU on a GPU", () => {
  const device = deviceOfGPU;

  test("a compute shader computes", async () => {
    const count = 1024;
    const storage = device.createBuffer({
      size: count * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    const readback = device.createBuffer({ size: count * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(
      storage,
      0,
      Float32Array.from({ length: count }, (_, i) => i),
    );
    const pipeline = await device.createComputePipelineAsync({
      layout: "auto",
      compute: {
        module: device.createShaderModule({
          code: `override scale: f32;
                 @group(0) @binding(0) var<storage, read_write> data: array<f32>;
                 @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) { data[id.x] *= scale; }`,
        }),
        constants: { scale: 3 },
      },
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(
      0,
      device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: storage }] }),
    );
    pass.dispatchWorkgroups(count / 64);
    pass.end();
    encoder.copyBufferToBuffer(storage, readback);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(readback.getMappedRange());
    expect([result[0], result[1], result[count - 1]]).toEqual([0, 3, (count - 1) * 3]);
    readback.unmap();
  });

  test("a render pass draws", async () => {
    const size = 64;
    const texture = device.createTexture({
      size: [size, size],
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const module = device.createShaderModule({
      code: `@vertex fn vs(@location(0) p: vec2f) -> @builtin(position) vec4f { return vec4f(p, 0, 1); }
             @fragment fn fs() -> @location(0) vec4f { return vec4f(0, 1, 0, 1); }`,
    });
    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module,
        buffers: [{ arrayStride: 8, attributes: [{ format: "float32x2", offset: 0, shaderLocation: 0 }] }],
      },
      fragment: { module, targets: [{ format: "rgba8unorm" }] },
    });
    const vertices = device.createBuffer({ size: 24, usage: GPUBufferUsage.VERTEX, mappedAtCreation: true });
    new Float32Array(vertices.getMappedRange()).set([-1, -1, 3, -1, -1, 3]);
    vertices.unmap();
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: texture, clearValue: [1, 0, 0, 1], loadOp: "clear", storeOp: "store" }],
    });
    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, vertices);
    // The triangle covers everything, and the viewport is the left half.
    pass.setViewport(0, 0, size / 2, size, 0, 1);
    pass.draw(3);
    pass.end();
    const readback = device.createBuffer({
      size: size * size * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    encoder.copyTextureToBuffer({ texture }, { buffer: readback, bytesPerRow: size * 4 }, [size, size]);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const pixels = new Uint8Array(readback.getMappedRange());
    expect([...pixels.subarray(0, 4)]).toEqual([0, 255, 0, 255]);
    expect([...pixels.subarray((size - 1) * 4, size * 4)]).toEqual([255, 0, 0, 255]);
    readback.unmap();
  });
});
