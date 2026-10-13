import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux } from "harness";

// bun-types does not declare the WebGPU globals (TypeScript's DOM lib and
// @webgpu/types do), so this file reads them untyped.
const gpu = (navigator as any).gpu;
const {
  GPU,
  GPUAdapter,
  GPUAdapterInfo,
  GPUBindGroup,
  GPUBindGroupLayout,
  GPUBuffer,
  GPUBufferUsage,
  GPUColorWrite,
  GPUCommandBuffer,
  GPUCompilationInfo,
  GPUCompilationMessage,
  GPUComputePipeline,
  GPUDevice,
  GPUDeviceLostInfo,
  GPUError,
  GPUInternalError,
  GPUMapMode,
  GPUOutOfMemoryError,
  GPUPipelineError,
  GPUPipelineLayout,
  GPUQuerySet,
  GPUQueue,
  GPURenderBundle,
  GPURenderBundleEncoder,
  GPURenderPipeline,
  GPUSampler,
  GPUShaderStage,
  GPUSupportedFeatures,
  GPUSupportedLimits,
  GPUTexture,
  GPUTextureUsage,
  GPUTextureView,
  GPUUncapturedErrorEvent,
  GPUValidationError,
} = globalThis as any;

// Whether this machine has a GPU API wgpu can use (Vulkan, Metal or D3D12; a
// software rasterizer counts). Everything under "with a device" needs one.
const hasAdapter = (await gpu.requestAdapter()) !== null;

// Whether that adapter is a software rasterizer (Mesa's llvmpipe, WARP). Only there may a test
// submit a shader that never ends: it is a CPU thread, and it dies with its process. On a GPU it
// hangs the GPU for every process until the system resets it, and the GPU of a virtual machine
// can stay gone after that.
const softwareAdapter = hasAdapter && (await gpu.requestAdapter()).info.isFallbackAdapter;

async function requestDevice(descriptor?: object): Promise<any> {
  const adapter = await gpu.requestAdapter();
  return await adapter.requestDevice(descriptor);
}

/** Runs `fn` inside a validation error scope and returns the error it captured. */
async function validationError(device: any, fn: () => unknown): Promise<any> {
  device.pushErrorScope("validation");
  fn();
  return await device.popErrorScope();
}

const doubleShader = /* wgsl */ `
  @group(0) @binding(0) var<storage, read_write> data: array<u32>;

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x < arrayLength(&data)) {
      data[id.x] = data[id.x] * 2u + 1u;
    }
  }
`;

describe("surface", () => {
  test("navigator.gpu is a GPU", () => {
    expect(gpu).toBeInstanceOf(GPU);
    expect((navigator as any).gpu).toBe(gpu);
    expect(gpu.getPreferredCanvasFormat()).toBe("bgra8unorm");
    // What naga implements of https://www.w3.org/TR/WGSL/#language-extensions-sec.
    expect([...gpu.wgslLanguageFeatures].sort()).toEqual([
      "packed_4x8_integer_dot_product",
      "pointer_composite_access",
      "readonly_and_readwrite_storage_textures",
    ]);
  });

  test("the first read of navigator.gpu runs no script", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          // Script that ran during the first read could read navigator.gpu again, and get another object.
          let calls = 0;
          for (const name of ["freeze", "defineProperty", "defineProperties", "create", "setPrototypeOf"]) {
            const real = Object[name];
            Object[name] = function (...args) {
              calls++;
              return real.apply(this, args);
            };
          }
          const gpu = navigator.gpu;
          const during = calls;
          console.log(during, navigator.gpu === gpu);
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("0 true\n");
    expect(exitCode).toBe(0);
  });

  test("every class is a global that cannot be constructed", () => {
    const names = [
      "GPU",
      "GPUAdapter",
      "GPUAdapterInfo",
      "GPUBindGroup",
      "GPUBindGroupLayout",
      "GPUBuffer",
      "GPUCommandBuffer",
      "GPUCommandEncoder",
      "GPUCompilationInfo",
      "GPUCompilationMessage",
      "GPUComputePassEncoder",
      "GPUComputePipeline",
      "GPUDevice",
      "GPUDeviceLostInfo",
      "GPUPipelineLayout",
      "GPUQuerySet",
      "GPUQueue",
      "GPURenderBundle",
      "GPURenderBundleEncoder",
      "GPURenderPassEncoder",
      "GPURenderPipeline",
      "GPUSampler",
      "GPUShaderModule",
      "GPUSupportedFeatures",
      "GPUSupportedLimits",
      "GPUTexture",
      "GPUTextureView",
      "WGSLLanguageFeatures",
    ];
    for (const name of names) {
      const constructor = (globalThis as any)[name];
      expect(constructor, name).toBeFunction();
      expect(constructor.name).toBe(name);
      expect(() => new constructor(), name).toThrow("Illegal constructor");
    }
  });

  test("the error classes can be constructed", () => {
    expect(() => new GPUError("x")).toThrow("Illegal constructor");
    for (const constructor of [GPUValidationError, GPUOutOfMemoryError, GPUInternalError]) {
      const error = new constructor("boom");
      expect(error).toBeInstanceOf(GPUError);
      expect(error).not.toBeInstanceOf(Error);
      expect(error.message).toBe("boom");
    }

    const pipelineError = new GPUPipelineError("bad pipeline", { reason: "validation" });
    expect(pipelineError).toBeInstanceOf(DOMException);
    expect(pipelineError.name).toBe("GPUPipelineError");
    expect(pipelineError.message).toBe("bad pipeline");
    expect(pipelineError.reason).toBe("validation");
    expect(() => new GPUPipelineError("x", { reason: "nope" })).toThrow(TypeError);

    const error = new GPUValidationError("uncaptured");
    const event = new GPUUncapturedErrorEvent("uncapturederror", { error });
    expect(event).toBeInstanceOf(Event);
    expect(event.type).toBe("uncapturederror");
    expect(event.error).toBe(error);
    expect(() => new GPUUncapturedErrorEvent("uncapturederror", {})).toThrow(TypeError);
  });

  test("the flag namespaces have the values the spec assigns", () => {
    expect(GPUBufferUsage).toEqual({
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
    expect(GPUMapMode).toEqual({ READ: 1, WRITE: 2 });
    expect(GPUTextureUsage).toEqual({
      COPY_SRC: 0x01,
      COPY_DST: 0x02,
      TEXTURE_BINDING: 0x04,
      STORAGE_BINDING: 0x08,
      RENDER_ATTACHMENT: 0x10,
      TRANSIENT_ATTACHMENT: 0x20,
    });
    expect(GPUShaderStage).toEqual({ VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 });
    expect(GPUColorWrite).toEqual({ RED: 1, GREEN: 2, BLUE: 4, ALPHA: 8, ALL: 15 });
  });

  test("a global can be replaced", () => {
    const original = (globalThis as any).GPUShaderStage;
    try {
      (globalThis as any).GPUShaderStage = 1;
      expect((globalThis as any).GPUShaderStage).toBe(1);
    } finally {
      (globalThis as any).GPUShaderStage = original;
    }
    expect((globalThis as any).GPUShaderStage.COMPUTE).toBe(4);
  });

  test("requestAdapter resolves to an adapter or to null", async () => {
    const adapter = await gpu.requestAdapter({ powerPreference: "low-power" });
    if (hasAdapter) expect(adapter).toBeInstanceOf(GPUAdapter);
    else expect(adapter).toBeNull();
    // A promise-returning operation reports bad arguments through the promise.
    await expect(gpu.requestAdapter({ powerPreference: "fast" })).rejects.toBeInstanceOf(TypeError);
  });
});

describe.skipIf(!hasAdapter)("with a device", () => {
  test("adapter: info, features, limits", async () => {
    const adapter = (await gpu.requestAdapter())!;
    expect(adapter.info).toBeInstanceOf(GPUAdapterInfo);
    expect(adapter.info).toBe(adapter.info);
    expect(adapter.info.description).toBeString();
    expect(adapter.info.isFallbackAdapter).toBeBoolean();

    expect(adapter.features).toBeInstanceOf(GPUSupportedFeatures);
    expect(adapter.features).toBe(adapter.features);
    expect(adapter.features.has("core-features-and-limits")).toBe(true);
    expect(adapter.features.size).toBe([...adapter.features].length);

    expect(adapter.limits).toBeInstanceOf(GPUSupportedLimits);
    expect(adapter.limits.maxBindGroups).toBeGreaterThanOrEqual(4);
    expect(adapter.limits.maxBufferSize).toBeGreaterThanOrEqual(268435456);
    expect(Object.prototype.toString.call(adapter.limits)).toBe("[object GPUSupportedLimits]");

    // The usual way to ask for everything the adapter has: the limits enumerate.
    const requiredLimits: Record<string, number> = {};
    for (const key in adapter.limits) requiredLimits[key] = adapter.limits[key];
    expect(requiredLimits.maxBufferSize).toBe(adapter.limits.maxBufferSize);
    const device = await adapter.requestDevice({ requiredLimits });
    expect(device.limits.maxBufferSize).toBe(adapter.limits.maxBufferSize);
    expect(device.limits.maxComputeInvocationsPerWorkgroup).toBe(adapter.limits.maxComputeInvocationsPerWorkgroup);
    expect(Object.prototype.toString.call(device)).toBe("[object GPUDevice]");
    device.destroy();
  });

  test("requestDevice: descriptor errors, and one device per adapter", async () => {
    const adapter = (await gpu.requestAdapter())!;
    await expect(adapter.requestDevice({ requiredFeatures: ["not-a-feature"] })).rejects.toBeInstanceOf(TypeError);
    await expect(adapter.requestDevice({ requiredLimits: { notALimit: 1 } })).rejects.toMatchObject({
      name: "OperationError",
    });
    await expect(adapter.requestDevice({ requiredLimits: { maxBindGroups: 1_000_000 } })).rejects.toMatchObject({
      name: "OperationError",
    });
    // An alignment limit has to be a power of 2.
    await expect(
      adapter.requestDevice({ requiredLimits: { minUniformBufferOffsetAlignment: 300 } }),
    ).rejects.toMatchObject({ name: "OperationError" });
    // A key that reads as an array index is a limit name like any other, and so is one that is not ASCII.
    await expect(adapter.requestDevice({ requiredLimits: { 0: 1 } })).rejects.toMatchObject({
      name: "OperationError",
    });
    await expect(adapter.requestDevice({ requiredLimits: { maxBindGröups: 1 } })).rejects.toMatchObject({
      name: "OperationError",
    });

    // A value that is worse than the default leaves the default in place.
    const device = await adapter.requestDevice({
      label: "first",
      defaultQueue: { label: "main queue" },
      requiredLimits: { maxBindGroups: 1, minStorageBufferOffsetAlignment: 1024, maxBufferSize: undefined },
    });
    expect(device).toBeInstanceOf(GPUDevice);
    expect(device).toBeInstanceOf(EventTarget);
    expect(device.label).toBe("first");
    device.label = "renamed";
    expect(device.label).toBe("renamed");
    expect(device.queue).toBeInstanceOf(GPUQueue);
    expect(device.queue).toBe(device.queue);
    expect(device.queue.label).toBe("main queue");
    expect(device.limits.maxBindGroups).toBe(4);
    expect(device.limits.minStorageBufferOffsetAlignment).toBe(256);
    expect(device.features.has("core-features-and-limits")).toBe(true);
    expect(device.adapterInfo.description).toBe(adapter.info.description);

    await expect(adapter.requestDevice()).rejects.toMatchObject({ name: "OperationError" });
    device.destroy();
  });

  test("compute: dispatch, copy, map and read back", async () => {
    const device = await requestDevice();
    const count = 1000;

    const storage = device.createBuffer({
      label: "storage",
      size: count * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
    });
    expect(storage).toBeInstanceOf(GPUBuffer);
    expect(storage.label).toBe("storage");
    expect(storage.size).toBe(count * 4);
    expect(storage.usage).toBe(GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    expect(storage.mapState).toBe("mapped");
    const input = storage.getMappedRange();
    expect(input).toBeInstanceOf(ArrayBuffer);
    expect(input.byteLength).toBe(count * 4);
    new Uint32Array(input).set(Array.from({ length: count }, (_, i) => i));
    storage.unmap();
    expect(storage.mapState).toBe("unmapped");
    expect(input.byteLength).toBe(0);

    const readback = device.createBuffer({ size: count * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

    const module = device.createShaderModule({ code: doubleShader });
    expect((await module.getCompilationInfo()).messages).toEqual([]);
    const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: storage } }],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(count / 64));
    pass.end();
    encoder.copyBufferToBuffer(storage, 0, readback, 0, count * 4);
    const commands = encoder.finish();
    expect(commands).toBeInstanceOf(GPUCommandBuffer);
    device.queue.submit([commands]);

    const mapped = readback.mapAsync(GPUMapMode.READ);
    expect(readback.mapState).toBe("pending");
    await mapped;
    expect(readback.mapState).toBe("mapped");
    const output = new Uint32Array(readback.getMappedRange());
    expect(Array.from(output)).toEqual(Array.from({ length: count }, (_, i) => i * 2 + 1));
    readback.unmap();
    expect(output.length).toBe(0);

    device.destroy();
  });

  test("queue.writeBuffer, partial ranges, onSubmittedWorkDone", async () => {
    const device = await requestDevice();
    const buffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    const readback = device.createBuffer({ size: 64, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

    const source = new Uint32Array([0, 10, 20, 30, 40, 50, 60, 70]);
    // dataOffset and size count elements when the source is a typed array.
    device.queue.writeBuffer(buffer, 16, source, 2, 4);
    device.queue.writeBuffer(buffer, 0, source.buffer, 4, 4);
    expect(() => device.queue.writeBuffer(buffer, 0, source, 7, 2)).toThrow(
      expect.objectContaining({ name: "OperationError" }),
    );
    expect(() => device.queue.writeBuffer(buffer, 0, new Uint8Array(6))).toThrow(
      expect.objectContaining({ name: "OperationError" }),
    );

    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(buffer, readback);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();

    await readback.mapAsync(GPUMapMode.READ, 0, 32);
    // The mapped range is [0, 32): a range inside it works, one past it does not.
    expect(() => readback.getMappedRange(32, 4)).toThrow(expect.objectContaining({ name: "OperationError" }));
    const head = new Uint32Array(readback.getMappedRange(0, 16));
    const tail = new Uint32Array(readback.getMappedRange(16, 16));
    expect(() => readback.getMappedRange(8, 16)).toThrow(expect.objectContaining({ name: "OperationError" }));
    expect(Array.from(head)).toEqual([10, 0, 0, 0]);
    expect(Array.from(tail)).toEqual([20, 30, 40, 50]);
    readback.unmap();
    expect(() => readback.getMappedRange()).toThrow(expect.objectContaining({ name: "OperationError" }));

    device.destroy();
  });

  test("mapAsync: write mapping, double map, unmap while pending", async () => {
    const device = await requestDevice();
    const upload = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC });
    const readback = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

    await upload.mapAsync(GPUMapMode.WRITE);
    new Uint32Array(upload.getMappedRange()).set([1, 2, 3, 4]);
    upload.unmap();

    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(upload, readback);
    device.queue.submit([encoder.finish()]);

    const first = readback.mapAsync(GPUMapMode.READ);
    await expect(readback.mapAsync(GPUMapMode.READ)).rejects.toMatchObject({ name: "OperationError" });
    await first;
    expect(Array.from(new Uint32Array(readback.getMappedRange()))).toEqual([1, 2, 3, 4]);
    readback.unmap();

    const aborted = readback.mapAsync(GPUMapMode.READ);
    readback.unmap();
    expect(readback.mapState).toBe("unmapped");
    // A new map right behind the aborted one is its own request.
    const again = readback.mapAsync(GPUMapMode.READ);
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    await again;
    expect(readback.mapState).toBe("mapped");
    expect(Array.from(new Uint32Array(readback.getMappedRange()))).toEqual([1, 2, 3, 4]);
    readback.unmap();

    // unmap() of a pending map leaves the buffer unmapped at once: a submission in the same task
    // can write it, and the next map waits for that submission.
    const other = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_SRC, mappedAtCreation: true });
    new Uint32Array(other.getMappedRange()).set([9, 8, 7, 6]);
    other.unmap();
    const target = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const cancelled = target.mapAsync(GPUMapMode.READ);
    target.unmap();
    const copy = device.createCommandEncoder();
    copy.copyBufferToBuffer(other, 0, target, 0, 16);
    expect(await validationError(device, () => device.queue.submit([copy.finish()]))).toBeNull();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    await target.mapAsync(GPUMapMode.READ);
    expect(Array.from(new Uint32Array(target.getMappedRange()))).toEqual([9, 8, 7, 6]);
    target.unmap();

    // Only unmap() detaches a mapped range. A transfer copies it, so the writes are not lost.
    await upload.mapAsync(GPUMapMode.WRITE);
    const written = upload.getMappedRange();
    new Uint32Array(written).set([5, 6, 7, 8]);
    expect(written.transfer().byteLength).toBe(16);
    expect(structuredClone(written, { transfer: [written] }).byteLength).toBe(16);
    expect(written.byteLength).toBe(16);
    upload.unmap();
    expect(written.byteLength).toBe(0);
    await upload.mapAsync(GPUMapMode.WRITE);
    expect(Array.from(new Uint32Array(upload.getMappedRange()))).toEqual([5, 6, 7, 8]);
    upload.unmap();

    // An invalid buffer fails validation too (CTS mapAsync,invalidBuffer).
    device.pushErrorScope("validation");
    const invalid = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.STORAGE });
    expect(await device.popErrorScope()).toBeInstanceOf(GPUValidationError);
    device.pushErrorScope("validation");
    await expect(invalid.mapAsync(GPUMapMode.READ)).rejects.toMatchObject({ name: "OperationError" });
    expect(await device.popErrorScope()).toBeInstanceOf(GPUValidationError);

    // A buffer destroyed before the call fails validation: OperationError, not AbortError.
    upload.destroy();
    device.pushErrorScope("validation");
    await expect(upload.mapAsync(GPUMapMode.WRITE)).rejects.toMatchObject({ name: "OperationError" });
    expect(await device.popErrorScope()).toBeInstanceOf(GPUValidationError);

    // The wrong mode is a validation error on the device and a rejected promise.
    device.pushErrorScope("validation");
    await expect(readback.mapAsync(GPUMapMode.WRITE)).rejects.toMatchObject({ name: "OperationError" });
    expect(await device.popErrorScope()).toBeInstanceOf(GPUValidationError);

    // So is mapping a buffer that is mapped. The mapping it has stays usable.
    await readback.mapAsync(GPUMapMode.READ);
    const range = readback.getMappedRange();
    device.pushErrorScope("validation");
    await expect(readback.mapAsync(GPUMapMode.READ)).rejects.toMatchObject({ name: "OperationError" });
    expect(await device.popErrorScope()).toBeInstanceOf(GPUValidationError);
    expect(readback.mapState).toBe("mapped");
    expect(Array.from(new Uint32Array(range))).toEqual([1, 2, 3, 4]);
    readback.unmap();
    expect(range.byteLength).toBe(0);
    await readback.mapAsync(GPUMapMode.READ);
    readback.unmap();

    device.destroy();
  });

  test("error scopes and uncapturederror", async () => {
    const device = await requestDevice();

    expect(await validationError(device, () => {})).toBeNull();
    await expect(device.popErrorScope()).rejects.toMatchObject({ name: "OperationError" });

    const error = await validationError(device, () => {
      device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.STORAGE });
    });
    expect(error).toBeInstanceOf(GPUValidationError);
    expect(error.message).toBeString();
    expect(error!.message.length).toBeGreaterThan(0);

    // Scopes nest: the inner out-of-memory scope does not take a validation error.
    device.pushErrorScope("validation");
    device.pushErrorScope("out-of-memory");
    device.createBuffer({ size: 16, usage: 0x8000 });
    expect(await device.popErrorScope()).toBeNull();
    expect(await device.popErrorScope()).toBeInstanceOf(GPUValidationError);

    // With no scope open the error becomes an event on the device.
    const { promise, resolve } = Promise.withResolvers<any>();
    device.onuncapturederror = event => {
      event.preventDefault();
      resolve(event);
    };
    expect(device.onuncapturederror).toBeFunction();
    device.createSampler({ lodMinClamp: 4, lodMaxClamp: 1 });
    const event = await promise;
    expect(event).toBeInstanceOf(GPUUncapturedErrorEvent);
    expect(event.type).toBe("uncapturederror");
    expect(event.target).toBe(device);
    expect(event.error).toBeInstanceOf(GPUValidationError);
    device.onuncapturederror = null;
    expect(device.onuncapturederror).toBeNull();

    device.destroy();
  });

  test("shader errors: getCompilationInfo and GPUPipelineError", async () => {
    const device = await requestDevice();

    device.pushErrorScope("validation");
    const broken = device.createShaderModule({ code: "\n\n  fn main() { let x: u32 = ; }" });
    expect(await device.popErrorScope()).toBeInstanceOf(GPUValidationError);
    const info = await broken.getCompilationInfo();
    expect(info).toBeInstanceOf(GPUCompilationInfo);
    expect(info.messages).toHaveLength(1);
    const [message] = info.messages;
    expect(message).toBeInstanceOf(GPUCompilationMessage);
    expect(message.type).toBe("error");
    expect(message.lineNum).toBe(3);
    expect(message.linePos).toBeGreaterThan(1);
    expect(message.message).toBeString();

    // Positions are in UTF-16 units, whatever the source has before the error.
    const code = "/* 😀 größe */ const π = 1;\nconst ü = 2; /* 😀 */ const wrong: u32 = 1.0;";
    device.pushErrorScope("validation");
    const typed = device.createShaderModule({ code });
    expect(await device.popErrorScope()).toBeInstanceOf(GPUValidationError);
    const [{ lineNum, linePos, offset, length }] = (await typed.getCompilationInfo()).messages;
    expect(code.slice(offset, offset + length)).toBe("wrong");
    expect({ lineNum, linePos }).toEqual({ lineNum: 2, linePos: code.split("\n")[1].indexOf("wrong") + 1 });

    const module = device.createShaderModule({ code: doubleShader });
    const pipeline = await device.createComputePipelineAsync({ layout: "auto", compute: { module } });
    expect(pipeline).toBeInstanceOf(GPUComputePipeline);

    device.pushErrorScope("validation");
    const rejected = device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "missing" } });
    await expect(rejected).rejects.toBeInstanceOf(GPUPipelineError);
    await expect(rejected).rejects.toMatchObject({ name: "GPUPipelineError", reason: "validation" });
    await rejected.catch(() => {});
    // The async form reports through the promise only.
    expect(await device.popErrorScope()).toBeNull();

    // A `requires` directive takes what wgslLanguageFeatures lists, and nothing else.
    for (const feature of [...gpu.wgslLanguageFeatures, "unrestricted_pointer_parameters"]) {
      const error = await validationError(device, () => {
        device.createShaderModule({ code: `requires ${feature};\n@compute @workgroup_size(1) fn main() {}` });
      });
      expect([feature, error === null]).toEqual([feature, gpu.wgslLanguageFeatures.has(feature)]);
    }

    device.destroy();
  });

  test("render: clear, draw a triangle into a texture, read it back", async () => {
    const device = await requestDevice();
    const size = 64;

    const module = device.createShaderModule({
      code: /* wgsl */ `
        @vertex
        fn vs(@location(0) position: vec2<f32>) -> @builtin(position) vec4<f32> {
          return vec4<f32>(position, 0.0, 1.0);
        }

        @fragment
        fn fs() -> @location(0) vec4<f32> {
          return vec4<f32>(1.0, 0.0, 0.0, 1.0);
        }
      `,
    });
    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module,
        entryPoint: "vs",
        buffers: [{ arrayStride: 8, attributes: [{ format: "float32x2", offset: 0, shaderLocation: 0 }] }],
      },
      fragment: { module, entryPoint: "fs", targets: [{ format: "rgba8unorm" }] },
      primitive: { topology: "triangle-list" },
    });
    expect(pipeline).toBeInstanceOf(GPURenderPipeline);

    // A triangle that covers the lower-left half of the target.
    const vertices = device.createBuffer({ size: 24, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(vertices, 0, new Float32Array([-1, -1, 3, -1, -1, 3]));

    const target = device.createTexture({
      size: [size, size],
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    expect(target).toBeInstanceOf(GPUTexture);
    expect(target).toMatchObject({
      width: size,
      height: size,
      depthOrArrayLayers: 1,
      mipLevelCount: 1,
      sampleCount: 1,
      dimension: "2d",
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const view = target.createView();
    expect(view).toBeInstanceOf(GPUTextureView);

    const readback = device.createBuffer({
      size: size * size * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 1, 1] }],
    });
    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, vertices);
    pass.setViewport(0, 0, size, size, 0, 1);
    pass.setScissorRect(0, 0, size, size / 2);
    pass.draw(3);
    pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: size * 4 }, [size, size]);
    device.queue.submit([encoder.finish()]);

    await readback.mapAsync(GPUMapMode.READ);
    const pixels = new Uint8Array(readback.getMappedRange());
    const pixel = (x: number, y: number) => Array.from(pixels.subarray((y * size + x) * 4, (y * size + x) * 4 + 4));
    // Inside the scissor the triangle is red; below the scissor only the clear colour is left.
    expect(pixel(2, 2)).toEqual([255, 0, 0, 255]);
    expect(pixel(2, size - 2)).toEqual([0, 0, 255, 255]);
    readback.unmap();

    target.destroy();
    device.destroy();
  });

  test("render: sampled texture, depth test, indexed draw in a bundle, occlusion query", async () => {
    const device = await requestDevice();
    const size = 16;

    // A 2x2 texture: green on the left, white on the right.
    const source = device.createTexture({
      size: [2, 2],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    // prettier-ignore
    const texels = new Uint8Array([
      0, 255, 0, 255,   255, 255, 255, 255,
      0, 255, 0, 255,   255, 255, 255, 255,
    ]);
    device.queue.writeTexture(
      { texture: source },
      texels,
      { bytesPerRow: 8, rowsPerImage: 2 },
      { width: 2, height: 2 },
    );

    const module = device.createShaderModule({
      code: /* wgsl */ `
        struct Params { depth: f32 };
        @group(0) @binding(0) var tex: texture_2d<f32>;
        @group(0) @binding(1) var samp: sampler;
        @group(0) @binding(2) var<uniform> params: Params;

        struct VOut { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };

        @vertex
        fn vs(@location(0) position: vec2<f32>) -> VOut {
          var out: VOut;
          out.position = vec4<f32>(position, params.depth, 1.0);
          out.uv = position * 0.5 + vec2<f32>(0.5);
          return out;
        }

        @fragment
        fn fs(in: VOut) -> @location(0) vec4<f32> {
          return textureSample(tex, samp, in.uv);
        }
      `,
    });

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { hasDynamicOffset: true, minBindingSize: 4 } },
      ],
    });
    const pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: {
        module,
        buffers: [{ arrayStride: 8, attributes: [{ format: "float32x2", offset: 0, shaderLocation: 0 }] }],
      },
      fragment: { module, targets: [{ format: "rgba8unorm", writeMask: GPUColorWrite.ALL }] },
      primitive: { topology: "triangle-list", cullMode: "none", frontFace: "ccw" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
    });

    // A full-target quad as two indexed triangles.
    const vertices = device.createBuffer({ size: 32, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(vertices, 0, new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]));
    const indices = device.createBuffer({ size: 12, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(indices, 0, new Uint16Array([0, 1, 2, 0, 2, 3]));

    // Two depth values 256 bytes apart, picked with a dynamic offset.
    const params = device.createBuffer({ size: 512, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(params, 0, new Float32Array([0.25]));
    device.queue.writeBuffer(params, 256, new Float32Array([0.75]));

    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: device.createSampler({ magFilter: "nearest", minFilter: "nearest" }) },
        { binding: 2, resource: { buffer: params, size: 4 } },
      ],
    });

    const bundleEncoder = device.createRenderBundleEncoder({
      colorFormats: ["rgba8unorm"],
      depthStencilFormat: "depth24plus",
    });
    bundleEncoder.setPipeline(pipeline);
    bundleEncoder.setVertexBuffer(0, vertices);
    bundleEncoder.setIndexBuffer(indices, "uint16");
    bundleEncoder.setBindGroup(0, bindGroup, [0]);
    bundleEncoder.drawIndexed(6);
    const bundle = bundleEncoder.finish();

    const target = device.createTexture({
      size: [size, size],
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const depth = device.createTexture({
      size: [size, size],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const querySet = device.createQuerySet({ type: "occlusion", count: 2 });
    const queryResults = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    const readback = device.createBuffer({
      size: size * 256 + 256,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const error = await validationError(device, () => {
      const encoder = device.createCommandEncoder();
      encoder.pushDebugGroup("frame");
      encoder.clearBuffer(readback);
      const pass = encoder.beginRenderPass({
        // A GPUTexture stands for its default view.
        colorAttachments: [{ view: target, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
        depthStencilAttachment: {
          view: depth.createView(),
          depthClearValue: 1,
          depthLoadOp: "clear",
          depthStoreOp: "discard",
        },
        occlusionQuerySet: querySet,
      });
      // The bundle draws the quad at depth 0.25.
      pass.executeBundles([bundle]);
      // Behind it, at depth 0.75: every fragment fails the depth test.
      pass.setPipeline(pipeline);
      pass.setVertexBuffer(0, vertices);
      pass.setIndexBuffer(indices, "uint16", 0, 12);
      pass.setBindGroup(0, bindGroup, new Uint32Array([256]), 0, 1);
      pass.beginOcclusionQuery(0);
      pass.drawIndexed(6, 1, 0, 0, 0);
      pass.endOcclusionQuery();
      pass.end();
      encoder.resolveQuerySet(querySet, 0, 1, queryResults, 0);
      encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: 256 }, [size, size]);
      encoder.copyBufferToBuffer(queryResults, 0, readback, size * 256, 8);
      encoder.popDebugGroup();
      device.queue.submit([encoder.finish()]);
    });
    expect(error).toBeNull();

    await readback.mapAsync(GPUMapMode.READ);
    const bytes = new Uint8Array(readback.getMappedRange());
    const pixel = (x: number, y: number) => Array.from(bytes.subarray(y * 256 + x * 4, y * 256 + x * 4 + 4));
    expect(pixel(2, 8)).toEqual([0, 255, 0, 255]);
    expect(pixel(size - 3, 8)).toEqual([255, 255, 255, 255]);
    // No sample of the second quad passed the depth test.
    expect(new BigUint64Array(bytes.buffer, size * 256, 1)[0]).toBe(0n);
    readback.unmap();
    device.destroy();
  });

  test("compute: indirect dispatch with pipeline constants", async () => {
    const device = await requestDevice();
    const module = device.createShaderModule({
      code: /* wgsl */ `
        override scale: u32 = 1u;
        @group(0) @binding(0) var<storage, read_write> data: array<u32>;

        @compute @workgroup_size(1)
        fn main(@builtin(workgroup_id) id: vec3<u32>) {
          data[id.x] = (id.x + 1u) * scale;
        }
      `,
    });
    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "main", constants: { scale: 10 } },
    });
    const data = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const indirect = device.createBuffer({ size: 12, usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(indirect, 0, new Uint32Array([3, 1, 1]));
    const readback = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    // A GPUBuffer stands for a binding of the whole buffer.
    pass.setBindGroup(
      0,
      device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: data }] }),
    );
    pass.dispatchWorkgroupsIndirect(indirect, 0);
    pass.end();
    encoder.copyBufferToBuffer(data, readback);
    device.queue.submit([encoder.finish()]);

    await readback.mapAsync(GPUMapMode.READ);
    expect(Array.from(new Uint32Array(readback.getMappedRange()))).toEqual([10, 20, 30, 0]);
    readback.unmap();
    device.destroy();
  });

  test("textures: writeTexture, samplers, bind group layouts, render bundles, query sets", async () => {
    const device = await requestDevice();

    const error = await validationError(device, () => {
      const texture = device.createTexture({
        size: { width: 4, height: 4 },
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
      });
      device.queue.writeTexture({ texture }, new Uint8Array(4 * 4 * 4).fill(7), { bytesPerRow: 16 }, [4, 4]);

      const sampler = device.createSampler({ magFilter: "linear", addressModeU: "repeat" });
      expect(sampler).toBeInstanceOf(GPUSampler);

      const layout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage", hasDynamicOffset: true } },
        ],
      });
      expect(layout).toBeInstanceOf(GPUBindGroupLayout);
      const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
      expect(pipelineLayout).toBeInstanceOf(GPUPipelineLayout);

      const storage = device.createBuffer({ size: 1024, usage: GPUBufferUsage.STORAGE });
      const bindGroup = device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: texture.createView() },
          { binding: 1, resource: sampler },
          { binding: 2, resource: { buffer: storage, size: 256 } },
        ],
      });
      expect(bindGroup).toBeInstanceOf(GPUBindGroup);

      // Dynamic offsets in both spellings.
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass({ label: "pass" });
      expect(pass.label).toBe("pass");
      pass.setBindGroup(0, bindGroup, [256]);
      pass.setBindGroup(0, bindGroup, new Uint32Array([0, 512, 0]), 1, 1);
      // With three arguments a Uint32Array is an ordinary sequence of offsets.
      pass.setBindGroup(0, bindGroup, new Uint32Array([512]));
      expect(() => pass.setBindGroup(0, bindGroup, new Uint32Array([0]), 1, 1)).toThrow(RangeError);
      expect(() => pass.setBindGroup(0, bindGroup, [0], 0, 1)).toThrow(TypeError);
      pass.end();
      encoder.finish();

      const bundleEncoder = device.createRenderBundleEncoder({ colorFormats: ["rgba8unorm"] });
      expect(bundleEncoder).toBeInstanceOf(GPURenderBundleEncoder);
      expect(bundleEncoder.finish({ label: "bundle" })).toBeInstanceOf(GPURenderBundle);

      const querySet = device.createQuerySet({ type: "occlusion", count: 4 });
      expect(querySet).toBeInstanceOf(GPUQuerySet);
      expect(querySet).toMatchObject({ type: "occlusion", count: 4 });
      querySet.destroy();
    });
    expect(error).toBeNull();

    // TRANSIENT_ATTACHMENT goes with RENDER_ATTACHMENT and with nothing else.
    const transient = (extra: number) =>
      validationError(device, () => {
        device.createTexture({
          size: [4, 4],
          format: "rgba8unorm",
          usage: GPUTextureUsage.TRANSIENT_ATTACHMENT | extra,
        });
      });
    expect(await transient(GPUTextureUsage.RENDER_ATTACHMENT)).toBeNull();
    expect(await transient(GPUTextureUsage.COPY_SRC)).toBeInstanceOf(GPUValidationError);
    expect(await transient(GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC)).toBeInstanceOf(
      GPUValidationError,
    );

    // A view usage with bits that are not a GPUTextureUsage is a validation error.
    expect(
      await validationError(device, () => {
        const texture = device.createTexture({ size: [4, 4], format: "rgba8unorm", usage: GPUTextureUsage.COPY_DST });
        expect(texture.createView({ usage: 0x8000 })).toBeInstanceOf(GPUTextureView);
      }),
    ).toBeInstanceOf(GPUValidationError);

    // Flag bits outside GPUShaderStage and GPUColorWrite are validation errors.
    expect(
      await validationError(device, () => {
        device.createBindGroupLayout({ entries: [{ binding: 0, visibility: 0xff, buffer: {} }] });
      }),
    ).toBeInstanceOf(GPUValidationError);
    expect(
      await validationError(device, () => {
        const module = device.createShaderModule({
          code: `
            @vertex fn vs() -> @builtin(position) vec4<f32> { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
            @fragment fn fs() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }
          `,
        });
        device.createRenderPipeline({
          layout: "auto",
          vertex: { module },
          fragment: { module, targets: [{ format: "rgba8unorm", writeMask: 0x1f }] },
        });
      }),
    ).toBeInstanceOf(GPUValidationError);

    // A layout entry has to pick exactly one kind of binding.
    expect(
      await validationError(device, () => {
        device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE }] });
      }),
    ).toBeInstanceOf(GPUValidationError);

    device.destroy();
  });

  test("argument conversion follows WebIDL", async () => {
    const device = await requestDevice();
    expect(() => device.createBuffer()).toThrow(TypeError);
    expect(() => device.createBuffer({ size: 4 })).toThrow(TypeError);
    expect(() => device.createBuffer({ size: -1, usage: GPUBufferUsage.COPY_DST })).toThrow(TypeError);
    expect(() => device.createBuffer({ size: NaN, usage: GPUBufferUsage.COPY_DST })).toThrow(TypeError);
    expect(() => device.createBuffer({ size: 2 ** 53, usage: GPUBufferUsage.COPY_DST })).toThrow(TypeError);
    expect(() => device.createBuffer({ size: 6, usage: GPUBufferUsage.COPY_DST, mappedAtCreation: true })).toThrow(
      RangeError,
    );
    expect(() => device.createTexture({ size: [4, 4], format: "rgba8", usage: 1 })).toThrow(TypeError);
    // A format behind a feature the device was not created with is a TypeError too.
    expect(() => device.createTexture({ size: [4, 4], format: "bc1-rgba-unorm", usage: 1 })).toThrow(
      "texture-compression-bc",
    );
    expect(() => device.createTexture({ size: [4, 4], format: "r16unorm", usage: 1 })).toThrow(TypeError);
    expect(() =>
      device.createTexture({ size: [4, 4], format: "rgba8unorm", usage: 1, viewFormats: ["astc-4x4-unorm"] }),
    ).toThrow(TypeError);
    expect(() => device.createTexture({ size: [], format: "rgba8unorm", usage: 1 })).toThrow(TypeError);
    expect(() => device.pushErrorScope("bogus")).toThrow(TypeError);
    expect(() => device.queue.submit([{}])).toThrow(TypeError);
    // A generic iterable is a sequence too.
    device.queue.submit(new Set());
    // Its conversion stops at the first element that fails, and closes the iterator.
    let pulled = 0;
    let closed = false;
    const viewFormats = {
      [Symbol.iterator]: () => ({
        next: () => ({ done: false, value: ++pulled === 1 ? "bogus" : "rgba8unorm" }),
        return: () => ((closed = true), {}),
      }),
    };
    expect(() => device.createTexture({ size: [4, 4], format: "rgba8unorm", usage: 1, viewFormats })).toThrow(
      TypeError,
    );
    expect({ pulled, closed }).toEqual({ pulled: 1, closed: true });

    // A pipeline constant is a restricted double.
    const module = device.createShaderModule({ code: doubleShader });
    expect(() =>
      device.createComputePipeline({ layout: "auto", compute: { module, constants: { scale: NaN } } }),
    ).toThrow(TypeError);

    // maxAnisotropy is the one [Clamp] integer: out of range values clamp, they do not throw.
    const linear = { magFilter: "linear", minFilter: "linear", mipmapFilter: "linear" };
    expect(
      await validationError(device, () => device.createSampler({ ...linear, maxAnisotropy: Infinity })),
    ).toBeNull();
    expect(await validationError(device, () => device.createSampler({ ...linear, maxAnisotropy: NaN }))).toBeInstanceOf(
      GPUValidationError,
    );

    // null is the empty dictionary, as an argument and as a member.
    expect(device.createSampler(null)).toBeInstanceOf(GPUSampler);
    expect(() => device.createBindGroupLayout(null)).toThrow(TypeError);
    expect(() => device.createBindGroupLayout({ entries: [null] })).toThrow(TypeError);
    expect(
      await validationError(device, () => {
        // `buffer: null` is a GPUBufferBindingLayout with every default: a uniform buffer.
        const layout = device.createBindGroupLayout({
          entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: null }],
        });
        const uniforms = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM });
        device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniforms } }] });
        const encoder = device.createCommandEncoder(null);
        encoder.beginComputePass(null).end();
        encoder.copyBufferToTexture(
          { buffer: device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_SRC }), bytesPerRow: 256 },
          {
            texture: device.createTexture({ size: [4, 1], format: "rgba8unorm", usage: GPUTextureUsage.COPY_DST }),
            origin: null,
          },
          [4, 1],
        );
        encoder.finish(null);
      }),
    ).toBeNull();

    // The argument count picks the overload, so a call that mixes the two forms of copyBufferToBuffer throws.
    const source = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_SRC });
    const target = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST });
    const copies = device.createCommandEncoder();
    expect(() => copies.copyBufferToBuffer(source, target, 0, 0, 16)).toThrow(TypeError);
    expect(() => copies.copyBufferToBuffer(source, target, 16, 0)).toThrow(TypeError);
    expect(() => copies.copyBufferToBuffer(source, 0, target)).toThrow(TypeError);
    expect(() => copies.copyBufferToBuffer(source)).toThrow(TypeError);
    copies.copyBufferToBuffer(source, target);
    copies.copyBufferToBuffer(source, target, 8);
    copies.copyBufferToBuffer(source, target, undefined);
    copies.copyBufferToBuffer(source, 0, target, 0);
    copies.copyBufferToBuffer(source, 4, target, 8, 8);
    expect(await validationError(device, () => copies.finish())).toBeNull();
    device.destroy();
  });

  test("destroy() resolves lost and unmaps the device's buffers", async () => {
    const device = await requestDevice();
    const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_SRC, mappedAtCreation: true });
    const range = buffer.getMappedRange();
    expect(buffer.mapState).toBe("mapped");

    const module = device.createShaderModule({ code: doubleShader });
    expect(device.lost).toBe(device.lost);
    device.destroy();
    const info = await device.lost;
    expect(info).toBeInstanceOf(GPUDeviceLostInfo);
    expect(info.reason).toBe("destroyed");
    expect(info.message).toBeString();
    expect(buffer.mapState).toBe("unmapped");
    expect(range.byteLength).toBe(0);

    // A lost device stays quiet: no exception and no error event.
    device.createBuffer({ size: 16, usage: 0x8000 });
    // mappedAtCreation still hands out a mapped buffer. Its ranges are zeroed memory.
    const late = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_SRC, mappedAtCreation: true });
    expect(late.mapState).toBe("mapped");
    expect(Array.from(new Uint8Array(late.getMappedRange()))).toEqual(new Array(16).fill(0));
    late.unmap();
    expect(late.mapState).toBe("unmapped");
    // The async pipeline calls resolve on it (with an invalid pipeline) and do not reject.
    expect(await device.createComputePipelineAsync({ layout: "auto", compute: { module } })).toBeInstanceOf(
      GPUComputePipeline,
    );
    // popErrorScope() on it resolves to null, with or without an open scope.
    expect(await device.popErrorScope()).toBeNull();
    device.pushErrorScope("validation");
    expect(await device.popErrorScope()).toBeNull();

    // Every destroy() unmaps, also a buffer that the lost device mapped at creation.
    const last = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_SRC, mappedAtCreation: true });
    const lastRange = last.getMappedRange();
    device.destroy();
    expect(last.mapState).toBe("unmapped");
    expect(lastRange.byteLength).toBe(0);
    expect(lastRange.detached).toBe(true);
  });

  test("objects survive garbage collection of the things that made them", async () => {
    const device = await requestDevice();
    let readback: any;
    {
      const encoder = device.createCommandEncoder();
      const source = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_SRC, mappedAtCreation: true });
      new Uint32Array(source.getMappedRange()).set([9, 8, 7, 6]);
      source.unmap();
      readback = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      encoder.copyBufferToBuffer(source, readback);
      device.queue.submit([encoder.finish()]);
    }
    for (let i = 0; i < 200; i++) device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST });
    Bun.gc(true);
    await readback.mapAsync(GPUMapMode.READ);
    Bun.gc(true);
    expect(Array.from(new Uint32Array(readback.getMappedRange()))).toEqual([9, 8, 7, 6]);
    readback.unmap();
    device.destroy();
  });

  test("a device and its listeners live for as long as script holds one of the device's objects", async () => {
    const kinds: [string, (device: any) => any, (object: any) => unknown][] = [
      [
        "queue and buffer",
        device => [device.queue, device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST })],
        ([queue, buffer]) => queue.writeBuffer(buffer, 0, new Uint8Array(64)),
      ],
      [
        "texture",
        device => device.createTexture({ size: [4, 4], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING }),
        texture => texture.createView({ format: "r8unorm" }),
      ],
      [
        "compute pipeline",
        device =>
          device.createComputePipeline({
            layout: "auto",
            compute: { module: device.createShaderModule({ code: doubleShader }) },
          }),
        pipeline => pipeline.getBindGroupLayout(99),
      ],
      ["command encoder", device => device.createCommandEncoder(), encoder => (encoder.finish(), encoder.finish())],
    ];
    for (const [kind, create, misuse] of kinds) {
      const uncaptured = Promise.withResolvers<string>();
      // Only what `create` returns leaves this function: script has no reference to the device.
      const object = await (async () => {
        const device = await requestDevice();
        device.addEventListener("uncapturederror", (event: any) => {
          event.preventDefault();
          uncaptured.resolve(`${kind}: ${event.error.constructor.name}`);
        });
        return create(device);
      })();
      Bun.gc(true);
      misuse(object);
      expect(await uncaptured.promise).toBe(`${kind}: GPUValidationError`);
    }
  });

  test("a call keeps the objects it reads alive while script collects garbage in the middle of it", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const adapter = await navigator.gpu.requestAdapter();
          const device = await adapter.requestDevice();
          // The objects that the getters and generators below hand out are garbage as soon as the call has read them.
          function collect() {
            for (let i = 0; i < 2000; i++) ({ a: [i, {}, "x" + i] });
            Bun.gc(true);
          }
          const compute = "override x: f32 = 1.0; @group(0) @binding(0) var<storage, read_write> data: array<f32>; @compute @workgroup_size(1) fn main() { data[0] = x; }";
          const draw = "@vertex fn vs() -> @builtin(position) vec4f { return vec4f(0, 0, 0, 1); } @fragment fn fs() -> @location(0) vec4f { return vec4f(1); }";
          const layout = () => device.createBindGroupLayout({
            entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }],
          });
          const target = usage => device.createTexture({ size: [4, 4], format: "rgba8unorm", usage });
          device.pushErrorScope("validation");

          device.createComputePipeline({
            layout: "auto",
            compute: {
              get module() { return device.createShaderModule({ code: compute }); },
              constants: { get x() { collect(); return 1; } },
            },
          });
          device.createPipelineLayout({
            bindGroupLayouts: (function* () { yield layout(); collect(); yield layout(); collect(); })(),
          });
          device.createBindGroup({
            get layout() { return layout(); },
            entries: [{
              binding: 0,
              resource: {
                get buffer() { return device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE }); },
                get offset() { collect(); return 0; },
              },
            }],
          });
          device.queue.submit((function* () {
            for (let i = 0; i < 4; i++) { yield device.createCommandEncoder().finish(); collect(); }
          })());

          // A render bundle encoder resolves what it was given in finish(), not before.
          const bundleEncoder = device.createRenderBundleEncoder({ colorFormats: ["rgba8unorm"] });
          (() => {
            const module = device.createShaderModule({ code: draw });
            bundleEncoder.setPipeline(device.createRenderPipeline({
              layout: "auto",
              vertex: { module },
              fragment: { module, targets: [{ format: "rgba8unorm" }] },
            }));
            bundleEncoder.setVertexBuffer(0, device.createBuffer({ size: 64, usage: GPUBufferUsage.VERTEX }));
            bundleEncoder.setIndexBuffer(device.createBuffer({ size: 64, usage: GPUBufferUsage.INDEX }), "uint16");
          })();
          for (let i = 0; i < 3; i++) { collect(); await 0; }
          bundleEncoder.draw(3);
          const bundle = bundleEncoder.finish();

          const encoder = device.createCommandEncoder();
          encoder.copyBufferToTexture(
            { get buffer() { return device.createBuffer({ size: 1024, usage: GPUBufferUsage.COPY_SRC }); }, bytesPerRow: 256 },
            { get texture() { collect(); return target(GPUTextureUsage.COPY_DST); }, get mipLevel() { collect(); return 0; } },
            [4, 4],
          );
          const pass = encoder.beginRenderPass({
            colorAttachments: [{
              get view() { return target(GPUTextureUsage.RENDER_ATTACHMENT).createView(); },
              get clearValue() { collect(); return [0, 0, 0, 1]; },
              loadOp: "clear",
              storeOp: "store",
            }],
          });
          pass.executeBundles((function* () {
            yield bundle;
            yield device.createRenderBundleEncoder({ colorFormats: ["rgba8unorm"] }).finish();
            collect();
          })());
          pass.end();
          device.queue.submit([encoder.finish()]);
          await device.queue.onSubmittedWorkDone();
          const error = await device.popErrorScope();
          console.log(error === null ? "ok" : error.message);
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("ok\n");
    expect(exitCode).toBe(0);
  });

  test("a shader override can be addressed by its numeric id, and by a name that is not ASCII", async () => {
    const device = await requestDevice();
    const module = device.createShaderModule({
      code: /* wgsl */ `
        @id(0) override size: u32 = 1;
        override größe: u32 = 1;
        override π: u32 = 1;
        @group(0) @binding(0) var<storage, read_write> out: array<u32>;
        @compute @workgroup_size(1) fn main() { out[0] = size * größe * π; }`,
    });
    const out = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const readback = device.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    // The numeric id is the only way to address an override that has one, and JSC keeps such a
    // key as an array index, where a lookup by name does not find it. A WGSL name can be any
    // Unicode identifier.
    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, constants: { 0: 7, größe: 3, π: 5 } },
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: out } }],
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
    encoder.copyBufferToBuffer(out, 0, readback, 0, 4);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    expect(new Uint32Array(readback.getMappedRange())[0]).toBe(105);
    readback.unmap();
    device.destroy();
  });

  test("a shader that nests deeper than the stack of the calling thread", async () => {
    const device = await requestDevice();
    // naga recurses once per level of the shader, and its parser does not, so its own recursion
    // limits never fire: these compile on a thread whose stack is sized for how deep the source
    // can nest. This depth overflows a stack sized for anything less (a debug build's frames are
    // about 15 times larger, and an ASAN build sizes for those).
    const depth = isDebug || isASAN ? 8000 : 30000;
    const not = "!".repeat(depth);
    const bodies = [
      `let x = ${not}true;`,
      `var a = 1; let x = ${"*&".repeat(depth / 2)}a;`,
      // Metal's compiler stops at 256 nested brackets.
      `var a = 1; if (a == 0) {} ${"else if (a == 1) {} ".repeat(200)}`,
      // One expression each: a ";" in a comment ends no statement, block comments nest, and a
      // line comment ends at every line break of WGSL, so what follows it is code.
      `let x = ${"!!!!!!!!/*;*/!!!!!!!!/*/*;*/;*/!!!!!!!!/*/;*/".repeat(depth / 24)}true;`,
      `let x = //;\r${not}true;`,
      `let x = //;\u2028${not}true;`,
    ];
    // The driver gets this one as it is (Metal's compiler has a nesting limit of its own). The
    // others fold to a constant first.
    if (isLinux) bodies.push(`var b = true; let x = ${not}b;`);
    for (const body of bodies) {
      device.pushErrorScope("validation");
      const module = device.createShaderModule({ code: `@compute @workgroup_size(1) fn main() { ${body} }` });
      device.createComputePipeline({ layout: "auto", compute: { module } });
      expect(await device.popErrorScope()).toBeNull();
    }
    // A name that contains "else" is no link of a chain, however often a block uses it.
    const names = `var elsewhere = 1; var or_else = 2; ${"elsewhere = or_else; ".repeat(1100)}`;
    expect(
      await validationError(device, () => {
        device.createShaderModule({ code: `@compute @workgroup_size(1) fn main() { ${names} }` });
      }),
    ).toBeNull();
    // naga keeps the module, and dropping an `if` chain recurses once per `else`, on whatever
    // thread holds the last reference. So a chain has a limit (1024 links; Chrome's is 127).
    const chain = `var a = 1; if (a == 0) {} ${"else if (a == 1) {} ".repeat(1025)}`;
    const error = await validationError(device, () => {
      device.createShaderModule({ code: `@compute @workgroup_size(1) fn main() { ${chain} }` });
    });
    expect(error).toBeInstanceOf(GPUValidationError);
    expect(error.message).toContain("nest too deep");
    device.destroy();
  });

  test("a long shader that does not nest compiles", async () => {
    const device = await requestDevice();
    // The stack of the compile thread follows how deep the source can nest, not how long it is, and
    // an `if` nests per `else` of its own chain, not per `else` of the source. Sized from its length,
    // this source asks a debug build for a 32 GB stack, which a machine with less memory refuses.
    const statements: string[] = [];
    for (let i = 0; i < 100; i++) {
      statements.push(
        `x = x * 1.0001 + ${i}.5; if (x > 9.0) { x = x - 9.0; } else if (x < 0.0) { x = 0.0; } else { x = x + 1.0; }`,
      );
    }
    const code = `
      // ${Buffer.alloc(1 << 19, "!;").toString()}
      /* ${Buffer.alloc(1 << 19, "!{").toString()} */
      @group(0) @binding(0) var<storage, read_write> data: array<f32>;
      @compute @workgroup_size(1) fn main() {
        var x = data[0];
        ${statements.join("\n")}
        data[0] = x;
      }`;
    device.pushErrorScope("validation");
    const module = device.createShaderModule({ code });
    device.createComputePipeline({ layout: "auto", compute: { module } });
    expect(await device.popErrorScope()).toBeNull();
    expect((await module.getCompilationInfo()).messages).toEqual([]);
    device.destroy();
  });

  test("a shader that can nest deeper than any compile thread's stack gives an invalid module and pipeline", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const adapter = await navigator.gpu.requestAdapter();
          const device = await adapter.requestDevice();
          const errors = [];
          device.addEventListener("uncapturederror", event => {
            event.preventDefault();
            errors.push(event.error.constructor.name);
          });
          // The stack this source asks for is more than a compile thread gets: nothing compiles it.
          const code = "@compute @workgroup_size(1) fn main() { let x = " + Buffer.alloc(6 << 20, "!").toString() + "true; }";
          const module = device.createShaderModule({ code });
          function collect() {
            for (let i = 0; i < 2000; i++) ({ a: [i, {}, "x" + i] });
            Bun.gc(true);
          }
          // The fallback names the layout again, so it has to keep it registered until then.
          const pipeline = device.createComputePipeline({
            get layout() { return device.createPipelineLayout({ bindGroupLayouts: [] }); },
            compute: { module, constants: { get x() { collect(); return 1; } } },
          });
          const info = await module.getCompilationInfo();
          console.log(module instanceof GPUShaderModule, pipeline instanceof GPUComputePipeline);
          console.log(JSON.stringify(errors), info.messages.map(message => message.type).join());
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe('true true\n["GPUValidationError","GPUValidationError"] error\n');
    expect(exitCode).toBe(0);
  });

  test("a resolve target of the wrong dimension is one validation error, which names the mistake", async () => {
    const device = await requestDevice();
    const uncaptured: string[] = [];
    device.addEventListener("uncapturederror", (event: any) => {
      event.preventDefault();
      uncaptured.push(event.error.message);
    });
    for (const size of [[4, 4, 4], [4]]) {
      const color = device.createTexture({
        size: [4, 4],
        format: "rgba8unorm",
        sampleCount: 4,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      // A 1d texture cannot be a render attachment, so the texture and its view are errors of their own.
      device.pushErrorScope("validation");
      const wrong = device
        .createTexture({
          size,
          dimension: size.length === 1 ? "1d" : "3d",
          format: "rgba8unorm",
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
        })
        .createView();
      await device.popErrorScope();
      const record = () => {
        const encoder = device.createCommandEncoder();
        encoder
          .beginRenderPass({
            colorAttachments: [{ view: color.createView(), resolveTarget: wrong, loadOp: "clear", storeOp: "store" }],
          })
          .end();
        encoder.finish();
      };

      const error = await validationError(device, record);
      expect(error).toBeInstanceOf(GPUValidationError);
      expect(error.message).toContain("resolve target has to be a 2d");

      // With no scope open, the one mistake is one event.
      uncaptured.length = 0;
      record();
      await device.queue.onSubmittedWorkDone();
      expect(uncaptured).toEqual([expect.stringContaining("resolve target has to be a 2d")]);
    }
    device.destroy();
  });

  test("a resource whose creation failed reports no size to the garbage collector", async () => {
    const device = await requestDevice();
    device.addEventListener("uncapturederror", (event: any) => event.preventDefault());
    // Nothing was allocated for these, so their estimated size is the wrapper alone. Counting the
    // requested size instead overflows the collector's accounting of memory it does not own.
    const texture = device.createTexture({
      size: [0xffffffff, 0xffffffff, 0xffffffff],
      format: "rgba8unorm",
      usage: GPUTextureUsage.COPY_DST,
    });
    const buffers = [];
    for (let i = 0; i < 2000; i++) {
      buffers.push(device.createBuffer({ size: Number.MAX_SAFE_INTEGER, usage: GPUBufferUsage.COPY_DST }));
    }
    Bun.gc(true);
    const junk = [];
    for (let i = 0; i < 200_000; i++) junk.push({ i });
    Bun.gc(true);
    expect(texture.width).toBe(0xffffffff);
    expect(buffers[0].size).toBe(Number.MAX_SAFE_INTEGER);
    device.destroy();
  });

  test("process.exit() with GPU work in flight stops the driver first", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const adapter = await navigator.gpu.requestAdapter();
          const device = await adapter.requestDevice();
          // A shader the driver has never seen: it is still compiling it when this process exits.
          const salt = (Date.now() ^ (performance.now() * 1e6)) >>> 0;
          const module = device.createShaderModule({
            code: \`@group(0) @binding(0) var<storage, read_write> data: array<u32>;
              @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                var x = data[id.x] + \${salt}u;
                for (var i = 0u; i < 100000u; i = i + 1u) { x = x * 1664525u + 1013904223u; }
                data[id.x] = x;
              }\`,
          });
          const pipeline = device.createComputePipeline({ layout: "auto", compute: { module } });
          const data = device.createBuffer({ size: 65536 * 4, usage: GPUBufferUsage.STORAGE });
          const bindGroup = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: data } }],
          });
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginComputePass();
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bindGroup);
          pass.dispatchWorkgroups(1024);
          pass.end();
          device.queue.submit([encoder.finish()]);
          console.log("submitted");
          process.exit(0);
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("submitted\n");
    expect(exitCode).toBe(0);
  });

  // Where the process leaves through a path that runs library exit handlers (macOS, Windows, every ASAN build), it first waits for the GPU.
  test.skipIf(!isLinux || isASAN || !softwareAdapter)(
    "process.exit() does not wait for GPU work that never ends",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const adapter = await navigator.gpu.requestAdapter();
          const device = await adapter.requestDevice();
          const module = device.createShaderModule({
            code: \`@group(0) @binding(0) var<storage, read_write> data: array<u32>;
              @compute @workgroup_size(1) fn main() {
                var x = data[0];
                loop { x = x * 1664525u + 1013904223u; if (data[1] == 1u) { break; } }
                data[0] = x;
              }\`,
          });
          const pipeline = device.createComputePipeline({ layout: "auto", compute: { module } });
          const data = device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE });
          const bindGroup = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: data } }],
          });
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginComputePass();
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bindGroup);
          pass.dispatchWorkgroups(1);
          pass.end();
          device.queue.submit([encoder.finish()]);
          console.log("submitted");
          process.exit(0);
        `,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe("submitted\n");
      expect(exitCode).toBe(0);
    },
  );

  test("process.exit() on the main thread while a Worker submits GPU work", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const source = \`
            const adapter = await navigator.gpu.requestAdapter();
            const device = await adapter.requestDevice();
            const module = device.createShaderModule({
              code: "@group(0) @binding(0) var<storage, read_write> d: array<u32>; @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) i: vec3<u32>) { d[i.x] = d[i.x] * 3u + 1u; }",
            });
            const pipeline = device.createComputePipeline({ layout: "auto", compute: { module } });
            const data = device.createBuffer({ size: 65536 * 4, usage: GPUBufferUsage.STORAGE });
            const bindGroup = device.createBindGroup({
              layout: pipeline.getBindGroupLayout(0),
              entries: [{ binding: 0, resource: { buffer: data } }],
            });
            postMessage("ready");
            for (;;) {
              const encoder = device.createCommandEncoder();
              const pass = encoder.beginComputePass();
              pass.setPipeline(pipeline);
              pass.setBindGroup(0, bindGroup);
              pass.dispatchWorkgroups(256);
              pass.end();
              device.queue.submit([encoder.finish()]);
              device.createBuffer({ size: 64, usage: GPUBufferUsage.COPY_DST });
              await 0;
            }
          \`;
          // The Worker keeps calling into wgpu-core while this thread exits, so the exit must leave
          // every id registered: wgpu-core panics on an id it no longer knows.
          const worker = new Worker(URL.createObjectURL(new Blob([source])));
          await new Promise(resolve => (worker.onmessage = resolve));
          console.log("exiting");
          process.exit(7);
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("exiting\n");
    expect(exitCode).toBe(7);
  });

  test.skipIf(!softwareAdapter)(
    "a device that becomes garbage while its work runs does not block the collector",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          // This shader never ends. The device is garbage as soon as this function returns, and
          // releasing it waits for the GPU, so that wait must not happen on this thread.
          async function fireAndForget() {
            const adapter = await navigator.gpu.requestAdapter();
            const device = await adapter.requestDevice();
            const module = device.createShaderModule({
              code: \`@group(0) @binding(0) var<storage, read_write> data: array<u32>;
                @compute @workgroup_size(1) fn main() {
                  var x = data[0];
                  loop { x = x * 1664525u + 1013904223u; if (data[1] == 1u) { break; } }
                  data[0] = x;
                }\`,
            });
            const pipeline = device.createComputePipeline({ layout: "auto", compute: { module } });
            const data = device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE });
            const bindGroup = device.createBindGroup({
              layout: pipeline.getBindGroupLayout(0),
              entries: [{ binding: 0, resource: { buffer: data } }],
            });
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginComputePass();
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(1);
            pass.end();
            device.queue.submit([encoder.finish()]);
          }
          await fireAndForget();
          Bun.gc(true);
          console.log("collected");
        `,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      // The line arrives as soon as the collector is done with the device. Before the fix the child
      // hung inside Bun.gc() for as long as the shader ran, which is for ever here.
      const reader = proc.stdout.getReader();
      const { value } = await reader.read();
      expect(new TextDecoder().decode(value)).toBe("collected\n");
      proc.kill();
    },
  );

  test("works in a Worker, and a Worker can be terminated with GPU work pending", async () => {
    const source = `
      const adapter = await navigator.gpu.requestAdapter();
      const device = await adapter.requestDevice();
      const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(buffer, 0, new Uint32Array([5, 6, 7, 8]));
      await buffer.mapAsync(GPUMapMode.READ);
      postMessage(Array.from(new Uint32Array(buffer.getMappedRange())));
      buffer.unmap();
      // Leave a map pending for terminate() to interrupt.
      device.queue.writeBuffer(buffer, 0, new Uint32Array([1, 1, 1, 1]));
      buffer.mapAsync(GPUMapMode.READ);
      postMessage("pending");
    `;
    const worker = new Worker(`data:text/javascript,${encodeURIComponent(source)}`);
    const messages: unknown[] = [];
    const { promise: pending, resolve, reject } = Promise.withResolvers<void>();
    worker.onerror = event => reject(event.error ?? new Error(event.message));
    worker.onmessage = event => {
      messages.push(event.data);
      if (event.data === "pending") resolve();
    };
    await pending;
    expect(messages).toEqual([[5, 6, 7, 8], "pending"]);
    const { promise: closed, resolve: onClose } = Promise.withResolvers<void>();
    worker.addEventListener("close", () => onClose());
    await worker.terminate();
    await closed;
  });

  test("mapAsync settles before a later onSubmittedWorkDone, also in a pipelined readback loop", async () => {
    const device = await requestDevice();
    const module = device.createShaderModule({ code: doubleShader });
    const pipeline = device.createComputePipeline({ layout: "auto", compute: { module } });
    const storage = device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: storage } }],
    });
    const submit = (readback: any) => {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(1);
      pass.end();
      encoder.copyBufferToBuffer(storage, 0, readback, 0, 256);
      device.queue.submit([encoder.finish()]);
    };
    const readbacks = [0, 1].map(() =>
      device.createBuffer({ size: 256, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
    );

    // The idiom the specification names: once the work is done, an earlier map is done too.
    const states: string[] = [];
    for (let i = 0; i < 40; i++) {
      submit(readbacks[0]);
      const mapped = readbacks[0].mapAsync(GPUMapMode.READ);
      await device.queue.onSubmittedWorkDone();
      states.push(readbacks[0].mapState);
      await mapped;
      readbacks[0].unmap();
    }
    expect(states).toEqual(Array(40).fill("mapped"));

    // Two frames in flight: frame k is submitted while the map of frame k - 1 is still pending.
    const pending: (Promise<void> | null)[] = [null, null];
    let frames = 0;
    for (let frame = 0; frame < 60; frame++) {
      const slot = frame % 2;
      if (pending[slot]) await pending[slot];
      const readback = readbacks[slot];
      submit(readback);
      pending[slot] = readback.mapAsync(GPUMapMode.READ).then(() => {
        frames += new Uint32Array(readback.getMappedRange()).length === 64 ? 1 : 0;
        readback.unmap();
      });
    }
    await Promise.all(pending);
    expect(frames).toBe(60);
    device.destroy();
  });

  test("a wait that a disposed Bun.ModuleGraph made does not stop the device's other waits", async () => {
    const device = await requestDevice();
    const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const graph = new Bun.ModuleGraph({});
    let settled = 0;
    // These start the device's poller from the graph's context, which stops before the poller is done.
    graph.run(() => {
      device.queue.onSubmittedWorkDone().then(() => settled++);
      buffer.mapAsync(GPUMapMode.READ).then(
        () => settled++,
        () => settled++,
      );
    });
    graph.dispose();
    await device.queue.onSubmittedWorkDone();
    const own = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    await own.mapAsync(GPUMapMode.READ);
    // The promises of a graph that was disposed stay pending.
    expect(settled).toBe(0);
    device.destroy();
  });

  test("a buffer that a disposed Bun.ModuleGraph was mapping can be mapped again", async () => {
    const device = await requestDevice();
    const make = () => device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const source = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_SRC });

    const buffer = make();
    const graph = new Bun.ModuleGraph({});
    graph.run(() => void buffer.mapAsync(GPUMapMode.READ).catch(() => {}));
    graph.dispose();
    // For script the request ends with the graph. wgpu-core still has it, and the next one waits for it.
    expect(buffer.mapState).toBe("unmapped");
    await buffer.mapAsync(GPUMapMode.READ);
    expect(buffer.mapState).toBe("mapped");
    buffer.unmap();
    // wgpu-core agrees that the buffer is unmapped: a submission that writes it validates.
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(source, 0, buffer, 0, 16);
    expect(await validationError(device, () => device.queue.submit([encoder.finish()]))).toBeNull();

    // A request of the host's is the host's, also when it had to wait behind one the graph gave up on.
    const other = make();
    const tenant = new Bun.ModuleGraph({});
    tenant.run(() => {
      void other.mapAsync(GPUMapMode.READ).catch(() => {});
      other.unmap();
    });
    const mapped = other.mapAsync(GPUMapMode.READ);
    tenant.dispose();
    await mapped;
    expect(other.mapState).toBe("mapped");
    device.destroy();
  });

  test.skipIf(!softwareAdapter)("a wait of a disposed Bun.ModuleGraph does not keep the process alive", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const adapter = await navigator.gpu.requestAdapter();
          const device = await adapter.requestDevice();
          const module = device.createShaderModule({
            code: \`@group(0) @binding(0) var<storage, read_write> data: array<u32>;
              @compute @workgroup_size(1) fn main() {
                var x = data[0];
                loop { x = x * 1664525u + 1013904223u; if (data[1] == 1u) { break; } }
                data[0] = x;
              }\`,
          });
          const pipeline = device.createComputePipeline({ layout: "auto", compute: { module } });
          const data = device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE });
          const bindGroup = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: data } }],
          });
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginComputePass();
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bindGroup);
          pass.dispatchWorkgroups(1);
          pass.end();
          device.queue.submit([encoder.finish()]);
          const graph = new Bun.ModuleGraph({});
          graph.run(() => void device.queue.onSubmittedWorkDone());
          graph.dispose();
          // The GPU work never ends, and nobody is left who waits for it.
          process.on("exit", () => console.log("exit"));
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    // The line arrives when the event loop has nothing left to wait for. (The exit itself can still wait for the GPU.)
    const reader = proc.stdout.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toBe("exit\n");
    proc.kill();
  });

  test.skipIf(!softwareAdapter)("a long wait for the GPU does not hold a thread of the work pool", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          import { stat } from "node:fs/promises";
          // As many devices as the pool has threads, each with a wait that never ends.
          for (let i = 0; i < 2; i++) {
            const adapter = await navigator.gpu.requestAdapter();
            const device = await adapter.requestDevice();
            const module = device.createShaderModule({
              code: \`@group(0) @binding(0) var<storage, read_write> data: array<u32>;
                @compute @workgroup_size(1) fn main() {
                  var x = data[0];
                  loop { x = x * 1664525u + 1013904223u; if (data[1] == 1u) { break; } }
                  data[0] = x;
                }\`,
            });
            const pipeline = device.createComputePipeline({ layout: "auto", compute: { module } });
            const data = device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE });
            const bindGroup = device.createBindGroup({
              layout: pipeline.getBindGroupLayout(0),
              entries: [{ binding: 0, resource: { buffer: data } }],
            });
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginComputePass();
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(1);
            pass.end();
            device.queue.submit([encoder.finish()]);
            device.queue.onSubmittedWorkDone();
          }
          // node:fs runs this on the pool.
          await stat(process.execPath);
          console.log("stat");
        `,
      ],
      env: { ...bunEnv, UV_THREADPOOL_SIZE: "2" },
      stderr: "pipe",
    });
    // Before the fix the two waits held both threads for as long as the shaders ran, which is for ever here.
    const reader = proc.stdout.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toBe("stat\n");
    proc.kill();
  });

  test("unmap() only detaches its own ArrayBuffers, whatever script puts on Array.prototype", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const adapter = await navigator.gpu.requestAdapter();
          const device = await adapter.requestDevice();
          const victim = new ArrayBuffer(8);
          let calls = 0;
          Object.defineProperty(Array.prototype, 0, {
            configurable: true,
            get() { calls++; return victim; },
            set() { calls++; },
          });
          const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_SRC, mappedAtCreation: true });
          const range = buffer.getMappedRange();
          buffer.unmap();
          delete Array.prototype[0];
          console.log(JSON.stringify({ calls, victim: victim.byteLength, range: range.byteLength }));
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ calls: 0, victim: 8, range: 0 });
    expect(exitCode).toBe(0);
  });

  test("a pending mapAsync keeps the process alive", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const adapter = await navigator.gpu.requestAdapter();
          const device = await adapter.requestDevice();
          const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
          device.queue.writeBuffer(buffer, 0, new Uint32Array([1, 2, 3, 4]));
          buffer.mapAsync(GPUMapMode.READ).then(() => {
            console.log(Array.from(new Uint32Array(buffer.getMappedRange())).join(","));
          });
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("1,2,3,4\n");
    expect(exitCode).toBe(0);
  });
});
