import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS } from "harness";
import { join } from "node:path";

// WebGPU ships in the macOS binary only (src/jsc/bindings/webgpu, Metal). On
// every other platform the feature-detection story is the same as in a browser
// without WebGPU: navigator.gpu is undefined and none of the GPU globals exist.

const gpuGlobals = [
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
] as const;

describe.skipIf(isMacOS)("WebGPU is absent on this platform", () => {
  test("navigator.gpu is undefined", () => {
    expect(navigator.gpu).toBeUndefined();
    expect("gpu" in navigator).toBe(false);
  });

  test("no GPU globals are installed", () => {
    for (const name of gpuGlobals) {
      expect(name in globalThis).toBe(false);
    }
  });
});

describe.skipIf(!isMacOS)("WebGPU API surface", () => {
  test("navigator.gpu is a GPU and always the same object", () => {
    expect(navigator.gpu).toBeInstanceOf(GPU);
    expect(navigator.gpu).toBe(navigator.gpu);
    expect(Object.prototype.toString.call(navigator.gpu)).toBe("[object GPU]");
    expect(navigator.gpu.getPreferredCanvasFormat()).toBe("bgra8unorm");
  });

  test("wgslLanguageFeatures is a setlike", () => {
    const features = navigator.gpu.wgslLanguageFeatures;
    expect(features).toBeInstanceOf(WGSLLanguageFeatures);
    expect(navigator.gpu.wgslLanguageFeatures).toBe(features);
    expect(typeof features.size).toBe("number");
    expect(typeof features.has).toBe("function");
    expect([...features].every(name => typeof name === "string")).toBe(true);
    expect(features.has("definitely-not-a-wgsl-feature")).toBe(false);
  });

  test("every interface and namespace from the spec is a global", () => {
    for (const name of gpuGlobals) {
      const value = (globalThis as any)[name];
      expect(value, name).toBeDefined();
      expect(typeof value, name).toBe("function");
    }
  });

  test("globals behave like the other web globals: writable and deletable", () => {
    const original = globalThis.GPUDevice;
    try {
      (globalThis as any).GPUDevice = 123;
      expect((globalThis as any).GPUDevice).toBe(123);
      expect(delete (globalThis as any).GPUDevice).toBe(true);
      expect((globalThis as any).GPUDevice).toBeUndefined();
    } finally {
      (globalThis as any).GPUDevice = original;
    }
  });

  test("constant namespaces carry the spec values", () => {
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
    expect({ ...GPUMapMode }).toEqual({ READ: 0x0001, WRITE: 0x0002 });
    expect({ ...GPUShaderStage }).toEqual({ VERTEX: 0x1, FRAGMENT: 0x2, COMPUTE: 0x4 });
    expect({ ...GPUTextureUsage }).toEqual({
      COPY_SRC: 0x01,
      COPY_DST: 0x02,
      TEXTURE_BINDING: 0x04,
      STORAGE_BINDING: 0x08,
      RENDER_ATTACHMENT: 0x10,
    });
    expect({ ...GPUColorWrite }).toEqual({ RED: 0x1, GREEN: 0x2, BLUE: 0x4, ALPHA: 0x8, ALL: 0xf });
  });

  test("error classes and GPUUncapturedErrorEvent are constructible", () => {
    const error = new GPUValidationError("bad bind group");
    expect(error.message).toBe("bad bind group");
    expect(new GPUOutOfMemoryError("oom")).toBeInstanceOf(GPUOutOfMemoryError);
    expect(new GPUInternalError("internal")).toBeInstanceOf(GPUInternalError);

    const pipelineError = new GPUPipelineError("no entry point", { reason: "validation" });
    expect(pipelineError).toBeInstanceOf(DOMException);
    expect(pipelineError.name).toBe("GPUPipelineError");
    expect(pipelineError.message).toBe("no entry point");
    expect(pipelineError.reason).toBe("validation");

    const event = new GPUUncapturedErrorEvent("uncapturederror", { error });
    expect(event).toBeInstanceOf(Event);
    expect(event.type).toBe("uncapturederror");
    expect(event.error).toBe(error);
  });

  test("interfaces without a constructor throw on new", () => {
    expect(() => new (GPUDevice as any)()).toThrow(TypeError);
    expect(() => new (GPUBuffer as any)()).toThrow(TypeError);
    expect(() => new (GPU as any)()).toThrow(TypeError);
  });

  test("dictionary arguments are type checked", async () => {
    // @ts-expect-error deliberately wrong
    await expect(navigator.gpu.requestAdapter(42)).rejects.toThrow(TypeError);
  });
});

// The rest needs a Metal device. Every Mac bun supports has one, but a CI box
// could conceivably run without a usable GPU, in which case requestAdapter()
// resolves to null per spec and these tests are skipped at runtime.
const adapter = isMacOS ? await navigator.gpu.requestAdapter() : null;

describe.skipIf(!adapter)("WebGPU on a real adapter", () => {
  async function requestDevice() {
    const device = await adapter!.requestDevice();
    expect(device).toBeInstanceOf(GPUDevice);
    return device;
  }

  test("adapter reports features and limits", async () => {
    expect(adapter).toBeInstanceOf(GPUAdapter);
    expect(adapter!.features).toBeInstanceOf(GPUSupportedFeatures);
    expect(adapter!.limits).toBeInstanceOf(GPUSupportedLimits);
    expect(adapter!.limits.maxBindGroups).toBeGreaterThanOrEqual(4);
    expect(adapter!.limits.maxBufferSize).toBeGreaterThanOrEqual(256 * 1024 * 1024);
    expect(adapter!.info).toBeInstanceOf(GPUAdapterInfo);
    expect(typeof adapter!.info.vendor).toBe("string");
  });

  test("device: queue, features, limits, label", async () => {
    const device = await requestDevice();
    expect(device.queue).toBeInstanceOf(GPUQueue);
    expect(device.queue).toBe(device.queue);
    expect(device.features).toBeInstanceOf(GPUSupportedFeatures);
    expect(device.limits.maxComputeWorkgroupSizeX).toBeGreaterThanOrEqual(256);
    device.label = "test device";
    expect(device.label).toBe("test device");
    device.destroy();
  });

  test("writeBuffer, copyBufferToBuffer, mapAsync round trip", async () => {
    const device = await requestDevice();
    const input = new Uint32Array([1, 2, 3, 4, 5, 6, 7, 8]);

    const source = device.createBuffer({
      size: input.byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const readback = device.createBuffer({
      size: input.byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    expect(source.size).toBe(input.byteLength);
    expect(readback.mapState).toBe("unmapped");

    device.queue.writeBuffer(source, 0, input);
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(source, 0, readback, 0, input.byteLength);
    const commands = encoder.finish();
    expect(commands).toBeInstanceOf(GPUCommandBuffer);
    device.queue.submit([commands]);

    await readback.mapAsync(GPUMapMode.READ);
    expect(readback.mapState).toBe("mapped");
    expect(Array.from(new Uint32Array(readback.getMappedRange()))).toEqual(Array.from(input));
    readback.unmap();
    expect(readback.mapState).toBe("unmapped");
    device.destroy();
  });

  test("a compute shader reads a buffer filled through mappedAtCreation", async () => {
    const device = await requestDevice();
    const count = 64;
    const byteLength = count * 4;

    // Filling the buffer through the mapping exercises the unmap() copy-back
    // path; the shader then proves the data reached the GPU.
    const data = device.createBuffer({
      size: byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
    });
    expect(data.mapState).toBe("mapped");
    const mapped = new Uint32Array(data.getMappedRange());
    for (let i = 0; i < count; i++) mapped[i] = i;
    data.unmap();

    const module = device.createShaderModule({
      code: `
        @group(0) @binding(0) var<storage, read_write> values: array<u32>;
        @compute @workgroup_size(${count})
        fn main(@builtin(global_invocation_id) id: vec3<u32>) {
          values[id.x] = values[id.x] * 2u + 1u;
        }
      `,
    });
    const info = await module.getCompilationInfo();
    expect(info.messages.filter(message => message.type === "error")).toEqual([]);

    const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
    expect(pipeline).toBeInstanceOf(GPUComputePipeline);
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: data } }],
    });
    const readback = device.createBuffer({
      size: byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
    encoder.copyBufferToBuffer(data, 0, readback, 0, byteLength);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();

    await readback.mapAsync(GPUMapMode.READ);
    const result = Array.from(new Uint32Array(readback.getMappedRange()));
    readback.unmap();
    expect(result).toEqual(Array.from({ length: count }, (_, i) => i * 2 + 1));
    device.destroy();
  });

  test("createComputePipelineAsync resolves, and rejects with GPUPipelineError on a bad shader", async () => {
    const device = await requestDevice();
    const good = device.createShaderModule({ code: `@compute @workgroup_size(1) fn main() {}` });
    const pipeline = await device.createComputePipelineAsync({ layout: "auto", compute: { module: good } });
    expect(pipeline).toBeInstanceOf(GPUComputePipeline);

    // Pipeline creation failures are reported on the pipeline, not as shader
    // module errors, so capture the validation error the bad module produces.
    device.pushErrorScope("validation");
    const bad = device.createShaderModule({ code: `this is not wgsl` });
    const badInfo = await bad.getCompilationInfo();
    expect(badInfo.messages.length).toBeGreaterThan(0);
    expect(badInfo.messages[0]).toBeInstanceOf(GPUCompilationMessage);
    expect(badInfo.messages[0].type).toBe("error");
    expect(badInfo.messages[0].lineNum).toBe(1);
    await expect(
      device.createComputePipelineAsync({ layout: "auto", compute: { module: bad } }),
    ).rejects.toBeInstanceOf(GPUPipelineError);
    await device.popErrorScope();
    device.destroy();
  });

  test("error scopes capture validation errors", async () => {
    const device = await requestDevice();
    device.pushErrorScope("validation");
    expect(await device.popErrorScope()).toBeNull();

    device.pushErrorScope("validation");
    // A buffer cannot be both mapped for reading and used as a vertex buffer.
    device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.VERTEX });
    const error = await device.popErrorScope();
    expect(error).toBeInstanceOf(GPUValidationError);
    expect(error!.message.length).toBeGreaterThan(0);
    device.destroy();
  });

  test("uncapturederror fires for errors no scope catches", async () => {
    const device = await requestDevice();
    const { promise, resolve } = Promise.withResolvers<GPUUncapturedErrorEvent>();
    device.addEventListener("uncapturederror", resolve as EventListener);
    device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.VERTEX });
    const event = await promise;
    expect(event).toBeInstanceOf(GPUUncapturedErrorEvent);
    expect(event.error).toBeInstanceOf(GPUValidationError);
    expect(event.target).toBe(device);
    device.destroy();
  });

  test("textures: writeTexture and copyTextureToBuffer round trip", async () => {
    const device = await requestDevice();
    const width = 4;
    const height = 2;
    const pixels = new Uint8Array(width * height * 4);
    for (let i = 0; i < pixels.length; i++) pixels[i] = i;

    const texture = device.createTexture({
      size: { width, height },
      format: "rgba8unorm",
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });
    expect(texture).toBeInstanceOf(GPUTexture);
    expect([texture.width, texture.height, texture.format]).toEqual([width, height, "rgba8unorm"]);
    expect(texture.createView()).toBeInstanceOf(GPUTextureView);

    device.queue.writeTexture({ texture }, pixels, { bytesPerRow: width * 4 }, { width, height });

    // bytesPerRow must be a multiple of 256 for copies into buffers.
    const bytesPerRow = 256;
    const readback = device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture }, { buffer: readback, bytesPerRow }, { width, height });
    device.queue.submit([encoder.finish()]);

    await readback.mapAsync(GPUMapMode.READ);
    const bytes = new Uint8Array(readback.getMappedRange());
    for (let row = 0; row < height; row++) {
      const rowBytes = Array.from(bytes.subarray(row * bytesPerRow, row * bytesPerRow + width * 4));
      expect(rowBytes).toEqual(Array.from(pixels.subarray(row * width * 4, (row + 1) * width * 4)));
    }
    readback.unmap();
    device.destroy();
  });

  test("device.lost resolves after destroy()", async () => {
    const device = await requestDevice();
    const lost = device.lost;
    device.destroy();
    const info = await lost;
    expect(info).toBeInstanceOf(GPUDeviceLostInfo);
    expect(info.reason).toBe("destroyed");
  });

  test("pending GPU work keeps the process alive until it completes", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "keepalive-fixture.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("submitted\nwork done\nmapped 4\n");
    expect(exitCode).toBe(0);
  });
});
