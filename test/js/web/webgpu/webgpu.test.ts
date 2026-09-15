import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

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
    expect([...gpu.wgslLanguageFeatures]).toEqual([]);
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

    const device = await adapter.requestDevice({ label: "first", requiredLimits: { maxBindGroups: 4 } });
    expect(device).toBeInstanceOf(GPUDevice);
    expect(device).toBeInstanceOf(EventTarget);
    expect(device.label).toBe("first");
    device.label = "renamed";
    expect(device.label).toBe("renamed");
    expect(device.queue).toBeInstanceOf(GPUQueue);
    expect(device.queue).toBe(device.queue);
    expect(device.limits.maxBindGroups).toBe(4);
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
    device.destroy();
  });

  test("destroy() resolves lost and unmaps the device's buffers", async () => {
    const device = await requestDevice();
    const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_SRC, mappedAtCreation: true });
    const range = buffer.getMappedRange();
    expect(buffer.mapState).toBe("mapped");

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
    // popErrorScope() on it resolves to null, with or without an open scope.
    expect(await device.popErrorScope()).toBeNull();
    device.pushErrorScope("validation");
    expect(await device.popErrorScope()).toBeNull();
    device.destroy();
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
