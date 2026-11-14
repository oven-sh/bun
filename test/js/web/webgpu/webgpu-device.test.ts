import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } from "bun:test";
import { tempDir } from "harness";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hasAdapter, requestDevice, runWithDriverOfChrome } from "./driver";

runWithDriverOfChrome(import.meta.path);

const { MAP_READ, MAP_WRITE, COPY_SRC, COPY_DST, STORAGE, UNIFORM, VERTEX, INDEX, INDIRECT, QUERY_RESOLVE } =
  GPUBufferUsage;
const { READ, WRITE } = GPUMapMode;
const { COMPUTE } = GPUShaderStage;
const { RENDER_ATTACHMENT, TEXTURE_BINDING } = GPUTextureUsage;

const domException = (name: string) => expect.objectContaining({ name, constructor: DOMException });
const emptyShader = "@compute @workgroup_size(1) fn main() {}";

describe.skipIf(!hasAdapter)("GPUAdapter", () => {
  test("describes itself", async () => {
    const adapter = (await navigator.gpu.requestAdapter())!;
    const { info, limits, features } = adapter;
    expect([adapter.info, adapter.limits, adapter.features].map((it, i) => it === [info, limits, features][i])).toEqual(
      [true, true, true],
    );
    for (const identifier of [info.vendor, info.architecture, info.device])
      expect(identifier).toMatch(/^$|^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(info.subgroupMinSize).toBeLessThanOrEqual(info.subgroupMaxSize);
    expect(features.has("core-features-and-limits")).toBe(true);
    expect([...features].filter(feature => /^(dawn|chromium)/.test(feature))).toEqual([]);
    expect(limits.maxBufferSize).toBeGreaterThanOrEqual(268435456);
    expect(limits.minUniformBufferOffsetAlignment).toBeGreaterThanOrEqual(32);
    expect(limits.minStorageBufferOffsetAlignment).toBeGreaterThanOrEqual(32);
  });

  test("is a fallback adapter if it runs on the CPU", async () => {
    const { architecture, isFallbackAdapter } = (await navigator.gpu.requestAdapter())!.info;
    expect(isFallbackAdapter).toBe(["software", "swiftshader", "warp"].includes(architecture));
  });

  test("forceFallbackAdapter gives none that is not one", async () => {
    const adapter = await navigator.gpu.requestAdapter({ forceFallbackAdapter: true });
    expect(adapter?.info.isFallbackAdapter ?? true).toBe(true);
  });

  test("makes one device", async () => {
    const adapter = (await navigator.gpu.requestAdapter())!;
    (await adapter.requestDevice()).destroy();
    await expect(adapter.requestDevice()).rejects.toEqual(domException("OperationError"));
  });

  test("gives the device the defaults, or every feature and limit it has", async () => {
    const plain = await requestDevice();
    expect([...plain.features]).toEqual(["core-features-and-limits"]);
    expect(plain.limits.maxBufferSize).toBe(268435456);
    expect(plain.limits.minUniformBufferOffsetAlignment).toBe(256);
    plain.destroy();

    const adapter = (await navigator.gpu.requestAdapter())!;
    const read = (limits: GPUSupportedLimits) =>
      Object.fromEntries(Object.keys(GPUSupportedLimits.prototype).map(name => [name, limits[name]]));
    const best = await adapter.requestDevice({
      label: "device",
      defaultQueue: { label: "queue" },
      requiredFeatures: adapter.features as any,
      requiredLimits: read(adapter.limits),
    });
    expect([...best.features].sort()).toEqual([...adapter.features].sort());
    expect(read(best.limits)).toEqual(read(adapter.limits));
    expect([best.label, best.queue.label, best.adapterInfo.vendor]).toEqual(["device", "queue", adapter.info.vendor]);
    best.destroy();
  });

  test("a compatibility device lacks the core feature", async () => {
    const adapter = (await navigator.gpu.requestAdapter({ featureLevel: "compatibility" }))!;
    const device = await adapter.requestDevice();
    expect(device.features.has("core-features-and-limits")).toBe(false);
    const texture = device.createTexture({ size: [1, 1, 2], format: "r8unorm", usage: TEXTURE_BINDING });
    expect(texture.textureBindingViewDimension).toBe("2d-array");
    device.destroy();
  });

  test("refuses what it does not support, and is not used up by that", async () => {
    const adapter = (await navigator.gpu.requestAdapter())!;
    for (const requiredLimits of [
      { noSuchLimit: 1 },
      { maxBindGroups: adapter.limits.maxBindGroups + 1 },
      { maxBindGroups: 0xffffffff },
      { maxBindGroups: 2 ** 32 + 1 },
      { minUniformBufferOffsetAlignment: 16 },
      { minStorageBufferOffsetAlignment: 257 },
    ])
      await expect(adapter.requestDevice({ requiredLimits })).rejects.toEqual(domException("OperationError"));
    await expect(adapter.requestDevice({ requiredLimits: { maxBindGroups: -1 } })).rejects.toThrow(TypeError);
    await expect(adapter.requestDevice({ requiredFeatures: ["other" as any] })).rejects.toThrow(TypeError);
    (await adapter.requestDevice({ requiredLimits: { noSuchLimit: undefined } })).destroy();
  });
});

describe.skipIf(!hasAdapter)("GPUDevice", () => {
  let device: GPUDevice;
  beforeAll(async () => {
    device = await requestDevice();
  });
  afterAll(() => device.destroy());
  beforeEach(() => device.pushErrorScope("validation"));
  afterEach(async () => expect((await device.popErrorScope())?.message).toBeUndefined());

  async function validationError(action: () => unknown) {
    device.pushErrorScope("validation");
    await action();
    return (await device.popErrorScope())?.message;
  }

  function submit(record: (encoder: GPUCommandEncoder) => void) {
    const encoder = device.createCommandEncoder();
    record(encoder);
    device.queue.submit([encoder.finish()]);
  }

  function bufferWith(data: ArrayBufferView, usage: number) {
    const buffer = device.createBuffer({ size: data.byteLength, usage, mappedAtCreation: true });
    new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    buffer.unmap();
    return buffer;
  }

  async function readBack(size: number, copy: (encoder: GPUCommandEncoder, to: GPUBuffer) => void) {
    const buffer = device.createBuffer({ size, usage: MAP_READ | COPY_DST });
    submit(encoder => copy(encoder, buffer));
    await buffer.mapAsync(READ);
    const bytes = buffer.getMappedRange().slice(0);
    buffer.destroy();
    return bytes;
  }
  const contentsOf = (buffer: GPUBuffer) =>
    readBack(buffer.size, (encoder, to) => encoder.copyBufferToBuffer(buffer, to));
  /** The rows of an `r8unorm` texture. */
  async function rowsOf(texture: GPUTexture) {
    const { width, height } = texture;
    const bytes = await readBack(256 * height, (encoder, buffer) =>
      encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: 256 }, { width, height }),
    );
    return Array.from({ length: height }, (_, y) => [...new Uint8Array(bytes, y * 256, width)]);
  }

  const computePipeline = (code: string, constants?: Record<string, number>) =>
    device.createComputePipeline({
      layout: "auto",
      compute: { module: device.createShaderModule({ code }), constants },
    });
  const bindGroup = (pipeline: GPUComputePipeline | GPURenderPipeline, ...resources: Bun.WebGPU.GPUBindingResource[]) =>
    device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: resources.map((resource, binding) => ({ binding, resource })),
    });

  describe("compute", () => {
    const multiply = `
      override factor: u32 = 2;
      @group(0) @binding(0) var<storage, read_write> data: array<u32>;
      @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
        if (id.x < arrayLength(&data)) { data[id.x] *= factor; }
      }`;
    const input = Uint32Array.from({ length: 1000 }, (_, i) => i);

    async function run(pipeline: GPUComputePipeline, dispatch: (pass: GPUComputePassEncoder) => void) {
      const data = bufferWith(input, STORAGE | COPY_SRC);
      submit(encoder => {
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup(pipeline, data));
        dispatch(pass);
        pass.end();
      });
      return new Uint32Array(await contentsOf(data));
    }

    test("dispatchWorkgroups()", async () => {
      expect(await run(computePipeline(multiply), pass => pass.dispatchWorkgroups(16))).toEqual(input.map(n => n * 2));
    });

    test("dispatchWorkgroupsIndirect()", async () => {
      const indirect = bufferWith(new Uint32Array([0, 1, 1, 1]), INDIRECT);
      expect(await run(computePipeline(multiply), pass => pass.dispatchWorkgroupsIndirect(indirect, 4))).toEqual(
        input.map((n, i) => (i < 64 ? n * 2 : n)),
      );
    });

    test("constants", async () => {
      expect(await run(computePipeline(multiply, { factor: 3 }), pass => pass.dispatchWorkgroups(16))).toEqual(
        input.map(n => n * 3),
      );
      expect(await validationError(() => computePipeline(multiply, { other: 3 }))).toContain("other");
      expect(await validationError(() => computePipeline(multiply, { "factor\0": 3 }))).toBeString();
      expect(() => computePipeline(multiply, { factor: NaN })).toThrow(TypeError);
    });

    test("createComputePipelineAsync()", async () => {
      const module = device.createShaderModule({ code: multiply });
      const pipelines = await Promise.all(
        [4, 5, 6].map(factor =>
          device.createComputePipelineAsync({
            label: `times ${factor}`,
            layout: "auto",
            compute: { module, entryPoint: "main", constants: { factor } },
          }),
        ),
      );
      expect(pipelines.map(pipeline => pipeline.label)).toEqual(["times 4", "times 5", "times 6"]);
      expect(await run(pipelines[1], pass => pass.dispatchWorkgroups(16))).toEqual(input.map(n => n * 5));

      const error = await device
        .createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "" } })
        .catch(error => error);
      expect(error).toBeInstanceOf(GPUPipelineError);
      expect(error.reason).toBe("validation");
      expect(error.stack).toBeString();
    });

    test("an explicit layout, dynamic offsets and a range of a buffer", async () => {
      const layout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: COMPUTE, buffer: { hasDynamicOffset: true } },
          { binding: 1, visibility: COMPUTE, buffer: { type: "storage" } },
        ],
      });
      const pipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [null, layout] }),
        compute: {
          module: device.createShaderModule({
            code: `
              @group(1) @binding(0) var<uniform> digit: u32;
              @group(1) @binding(1) var<storage, read_write> sum: u32;
              @compute @workgroup_size(1) fn main() { sum = sum * 10 + digit; }`,
          }),
        },
      });
      const digits = bufferWith(
        Uint32Array.from({ length: 256 }, (_, i) => i / 64 + 1),
        UNIFORM,
      );
      const sums = device.createBuffer({ size: 260, usage: STORAGE | COPY_SRC });
      const group = device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: digits, size: 4 } },
          { binding: 1, resource: { buffer: sums, offset: 256 } },
        ],
      });
      submit(encoder => {
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        for (const set of [
          () => pass.setBindGroup(1, group, [256]),
          () => pass.setBindGroup(1, group, new Uint32Array([768])),
          () => pass.setBindGroup(1, group, new Uint32Array([1, 512, 1]), 1, 1),
          () => pass.setBindGroup(1, group, new Uint32Array(new SharedArrayBuffer(4)), 0, 1),
        ]) {
          set();
          pass.dispatchWorkgroups(1);
        }
        expect(() => pass.setBindGroup(1, group, new Uint32Array(2), 2, 1)).toThrow(RangeError);
        expect(() => pass.setBindGroup(1, group, new Uint32Array(2), 2 ** 53 - 1, 0xffffffff)).toThrow(RangeError);
        expect(() => pass.setBindGroup(1, group, [0] as any, 0, 1)).toThrow(TypeError);
        expect(() => (pass as any).setBindGroup(1, group, new Uint32Array(2), 0)).toThrow(TypeError);
        pass.end();
      });
      expect(new Uint32Array(await contentsOf(sums))[64]).toBe(2431);
    });

    test("setImmediates()", async () => {
      const layout = device.createBindGroupLayout({
        entries: [{ binding: 0, visibility: COMPUTE, buffer: { type: "storage" } }],
      });
      const pipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout], immediateSize: 8 }),
        compute: {
          module: device.createShaderModule({
            code: `
              var<immediate> pair: vec2u;
              @group(0) @binding(0) var<storage, read_write> out: vec2u;
              @compute @workgroup_size(1) fn main() { out = pair; }`,
          }),
        },
      });
      const out = device.createBuffer({ size: 8, usage: STORAGE | COPY_SRC });
      submit(encoder => {
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, device.createBindGroup({ layout, entries: [{ binding: 0, resource: out }] }));
        pass.setImmediates(0, new Uint32Array([1, 2]));
        pass.setImmediates(4, new Uint32Array([7, 8, 9]), 1, 1);
        expect(() => pass.setImmediates(0, new Uint8Array(3))).toThrow(domException("OperationError"));
        pass.dispatchWorkgroups(1);
        pass.end();
      });
      expect(new Uint32Array(await contentsOf(out))).toEqual(new Uint32Array([1, 8]));
    });

    test.each(["texture_2d<f32>", "texture_external"])("a %s is bound to a texture or to a view", async type => {
      const pipeline = computePipeline(`
        @group(0) @binding(0) var image: ${type};
        @group(0) @binding(1) var nearest: sampler;
        @group(0) @binding(2) var<storage, read_write> out: u32;
        @compute @workgroup_size(1) fn main() {
          out += u32(round(textureSampleBaseClampToEdge(image, nearest, vec2f(0.75, 0.5)).r * 255));
        }`);
      const texture = device.createTexture({
        size: [2],
        format: "rgba8unorm",
        usage: TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      device.queue.writeTexture(
        { texture, origin: [1] },
        new Uint8Array([9, 9, 9, 9, 40, 0, 0, 255]),
        { offset: 4 },
        [1],
      );
      const out = device.createBuffer({ size: 4, usage: STORAGE | COPY_SRC });
      submit(encoder => {
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        for (const image of [texture, texture.createView()]) {
          pass.setBindGroup(0, bindGroup(pipeline, image, device.createSampler(), out));
          pass.dispatchWorkgroups(1);
        }
        pass.end();
      });
      expect(new Uint32Array(await contentsOf(out))[0]).toBe(80);
    });
  });

  describe("render", () => {
    const target = (format: Bun.WebGPU.GPUTextureFormat = "r8unorm", sampleCount = 1) =>
      device.createTexture({
        size: { width: 4, height: 2 },
        format,
        sampleCount,
        usage: RENDER_ATTACHMENT | (sampleCount === 1 ? GPUTextureUsage.COPY_SRC : 0),
      });
    const clear = (view: GPUTexture | GPUTextureView) =>
      ({ view, clearValue: { r: 10 / 255, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }) as const;
    /** The left half is vertices 0 to 3, and the right half is vertices 4 to 7. */
    const corners = new Float32Array([-1, -1, 0, -1, -1, 1, 0, 1, 0, -1, 1, -1, 0, 1, 1, 1]);
    const descriptor = (rest?: Partial<GPURenderPipelineDescriptor>): GPURenderPipelineDescriptor => {
      const module = device.createShaderModule({
        code: `
          struct Vertex { @builtin(position) position: vec4f, @location(0) @interpolate(flat) value: f32 }
          @vertex fn vertex(@location(0) corner: vec2f, @location(1) value: f32) -> Vertex {
            return Vertex(vec4f(corner, value / 255, 1), value / 255);
          }
          @fragment fn fragment(in: Vertex) -> @location(1) vec4f { return vec4f(in.value); }`,
      });
      return {
        layout: "auto",
        vertex: {
          module,
          buffers: [
            { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }] },
            null,
            { arrayStride: 4, stepMode: "instance", attributes: [{ shaderLocation: 1, offset: 0, format: "float32" }] },
          ],
        },
        primitive: { topology: "triangle-strip", stripIndexFormat: "uint16" },
        fragment: { module, targets: [null, { format: "r8unorm" }] },
        ...rest,
      };
    };
    function bind(encoder: GPURenderPassEncoder | GPURenderBundleEncoder, pipeline: GPURenderPipeline) {
      encoder.setPipeline(pipeline);
      encoder.setVertexBuffer(0, bufferWith(corners, VERTEX));
      encoder.setVertexBuffer(1, null);
      encoder.setVertexBuffer(2, bufferWith(new Float32Array([0, 20, 30]), VERTEX), 4);
      encoder.setIndexBuffer(bufferWith(new Uint16Array([9, 9, 0, 1, 2, 3]), INDEX), "uint16", 4, 8);
    }
    async function render(
      pipeline: GPURenderPipeline,
      draw: (pass: GPURenderPassEncoder) => void,
      rest?: Partial<GPURenderPassDescriptor>,
    ) {
      const texture = target();
      submit(encoder => {
        const pass = encoder.beginRenderPass({ colorAttachments: [null, clear(texture)], ...rest });
        bind(pass, pipeline);
        draw(pass);
        pass.end();
      });
      return rowsOf(texture);
    }
    const twice = (row: number[]) => [row, row];

    test.each<[string, (pass: GPURenderPassEncoder) => void, number[][]]>([
      ["draw()", pass => pass.draw(4), twice([20, 20, 10, 10])],
      ["draw() from a vertex and an instance", pass => pass.draw(4, 1, 4, 1), twice([10, 10, 30, 30])],
      ["drawIndexed()", pass => pass.drawIndexed(4, 1, 0, 4), twice([10, 10, 20, 20])],
      [
        "drawIndirect()",
        pass => pass.drawIndirect(bufferWith(new Uint32Array([4, 1, 4, 0]), INDIRECT), 0),
        twice([10, 10, 20, 20]),
      ],
      [
        "drawIndexedIndirect()",
        pass => pass.drawIndexedIndirect(bufferWith(new Uint32Array([4, 1, 0, 0, 0]), INDIRECT), 0),
        twice([20, 20, 10, 10]),
      ],
      ["setViewport()", pass => (pass.setViewport(2, 0, 2, 2, 0, 1), pass.draw(4)), twice([10, 10, 20, 10])],
      [
        "setScissorRect()",
        pass => (pass.setScissorRect(1, 1, 3, 1), pass.draw(4)),
        [
          [10, 10, 10, 10],
          [10, 20, 10, 10],
        ],
      ],
    ])("%s", async (_, draw, expected) => {
      expect(await render(device.createRenderPipeline(descriptor()), draw)).toEqual(expected);
    });

    test("createRenderPipelineAsync()", async () => {
      expect(await render(await device.createRenderPipelineAsync(descriptor()), pass => pass.draw(4))).toEqual(
        twice([20, 20, 10, 10]),
      );
      await expect(device.createRenderPipelineAsync(descriptor({ multisample: { count: 3 } }))).rejects.toBeInstanceOf(
        GPUPipelineError,
      );
    });

    test("a render bundle", async () => {
      const pipeline = device.createRenderPipeline(descriptor());
      const encoder = device.createRenderBundleEncoder({ colorFormats: [null, "r8unorm"] });
      bind(encoder, pipeline);
      encoder.draw(4, 1, 4);
      const bundle = encoder.finish({ label: "bundle" });
      expect(bundle.label).toBe("bundle");
      expect(await render(pipeline, pass => pass.executeBundles(new Set([bundle])))).toEqual(twice([10, 10, 20, 20]));
    });

    test("blending", async () => {
      const blended = descriptor();
      blended.fragment!.targets = [
        null,
        { format: "r8unorm", blend: { color: { srcFactor: "constant", dstFactor: "one" }, alpha: {} } },
      ];
      const draw = (pass: GPURenderPassEncoder) => (pass.setBlendConstant([0.5, 0, 0, 0]), pass.draw(4, 1, 0, 0));
      expect(await render(device.createRenderPipeline(blended), draw)).toEqual(twice([20, 20, 10, 10]));
    });

    test("depth, stencil and occlusion queries", async () => {
      const pipeline = device.createRenderPipeline(
        descriptor({
          depthStencil: {
            format: "depth24plus-stencil8",
            depthWriteEnabled: true,
            depthCompare: "less",
            stencilFront: { compare: "equal" },
            stencilBack: { compare: "equal" },
          },
        }),
      );
      const occlusionQuerySet = device.createQuerySet({ type: "occlusion", count: 3 });
      expect([occlusionQuerySet.type, occlusionQuerySet.count]).toEqual(["occlusion", 3]);
      const draw = (pass: GPURenderPassEncoder) => {
        for (const [query, reference, instance] of [
          [0, 7, 0],
          [1, 7, 1],
          [2, 8, 0],
        ]) {
          pass.setStencilReference(reference);
          pass.beginOcclusionQuery(query);
          pass.draw(4, 1, query === 2 ? 4 : 0, instance);
          pass.endOcclusionQuery();
        }
      };
      const depthStencilAttachment = {
        view: device.createTexture({ size: [4, 2], format: "depth24plus-stencil8", usage: RENDER_ATTACHMENT }),
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "discard",
        stencilClearValue: 7,
        stencilLoadOp: "clear",
        stencilStoreOp: "discard",
      } as const;
      expect(await render(pipeline, draw, { depthStencilAttachment, occlusionQuerySet })).toEqual(
        twice([20, 20, 10, 10]),
      );
      const results = device.createBuffer({ size: 24, usage: QUERY_RESOLVE | COPY_SRC });
      submit(encoder => encoder.resolveQuerySet(occlusionQuerySet, 0, 3, results, 0));
      expect([...new BigUint64Array(await contentsOf(results))].map(samples => samples > 0)).toEqual([
        true,
        false,
        false,
      ]);
      occlusionQuerySet.destroy();
    });

    test("multisampling", async () => {
      const resolveTarget = target();
      const colorAttachments = [null, { ...clear(target("r8unorm", 4).createView()), resolveTarget }];
      const pipeline = device.createRenderPipeline(descriptor({ multisample: { count: 4 } }));
      await render(pipeline, pass => pass.draw(4), { colorAttachments });
      expect(await rowsOf(resolveTarget)).toEqual(twice([20, 20, 10, 10]));
    });

    test("maxDrawCount", async () => {
      const pipeline = device.createRenderPipeline(descriptor());
      const draw = (pass: GPURenderPassEncoder) => (pass.draw(4), pass.draw(4));
      expect(await validationError(() => render(pipeline, draw, { maxDrawCount: 1 }))).toContain("drawCount");
    });
  });

  describe("copies", () => {
    test("writeBuffer() counts in elements of the data", async () => {
      const buffer = device.createBuffer({ size: 32, usage: COPY_SRC | COPY_DST });
      const bytes = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
      const shared = new Uint8Array(new SharedArrayBuffer(4)).fill(99);
      device.queue.writeBuffer(buffer, 0, bytes.buffer, 4, 4);
      device.queue.writeBuffer(buffer, 4, new DataView(bytes.buffer, 8), 4);
      device.queue.writeBuffer(buffer, 8, new Uint16Array(bytes.buffer, 2), 1, 2);
      device.queue.writeBuffer(buffer, 12, new Float64Array(bytes.buffer), 1);
      device.queue.writeBuffer(buffer, 20, shared);
      device.queue.writeBuffer(buffer, 24, shared.buffer);
      device.queue.writeBuffer(buffer, 28, bytes, 16);
      expect([...new Uint8Array(await contentsOf(buffer))]).toEqual([
        ...[5, 6, 7, 8, 13, 14, 15, 16, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
        ...[99, 99, 99, 99, 99, 99, 99, 99, 0, 0, 0, 0],
      ]);

      for (const [offset, size] of [[17], [0, 20], [8, 12], [0, 3], [1], [2 ** 53 - 1, 2 ** 53 - 1]])
        expect(() => device.queue.writeBuffer(buffer, 0, bytes, offset, size)).toThrow(domException("OperationError"));
      expect(() => device.queue.writeBuffer(buffer, 0, [1, 2, 3, 4] as any)).toThrow(TypeError);
    });

    test("copyBufferToBuffer() and clearBuffer()", async () => {
      const source = bufferWith(new Uint32Array([1, 2, 3, 4]), COPY_SRC);
      const copy = async (record: (encoder: GPUCommandEncoder, to: GPUBuffer) => void) => [
        ...new Uint32Array(await readBack(16, record)),
      ];
      expect(await copy((encoder, to) => encoder.copyBufferToBuffer(source, to))).toEqual([1, 2, 3, 4]);
      expect(await copy((encoder, to) => encoder.copyBufferToBuffer(source, to, 8))).toEqual([1, 2, 0, 0]);
      expect(await copy((encoder, to) => encoder.copyBufferToBuffer(source, 8, to, 4))).toEqual([0, 3, 4, 0]);
      expect(await copy((encoder, to) => encoder.copyBufferToBuffer(source, 4, to, 8, 4))).toEqual([0, 0, 2, 0]);
      const cleared = (...range: number[]) =>
        copy((encoder, to) => (encoder.copyBufferToBuffer(source, to), encoder.clearBuffer(to, ...range)));
      expect([await cleared(), await cleared(8), await cleared(4, 4)]).toEqual([
        [0, 0, 0, 0],
        [1, 2, 0, 0],
        [1, 0, 3, 4],
      ]);
      expect(
        await validationError(() => copy((encoder, to) => encoder.copyBufferToBuffer(source, 20, to, 0))),
      ).toContain("does not fit");
    });

    test("between buffers and textures", async () => {
      const usage = GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
      const layered = device.createTexture({ size: [4, 4, 2], mipLevelCount: 2, format: "r8unorm", usage });
      const flat = device.createTexture({ size: [3, 2], format: "r8unorm", usage });
      const buffer = bufferWith(
        Uint8Array.from({ length: 264 }, (_, i) => i % 250),
        COPY_SRC,
      );
      const texture = { texture: layered, mipLevel: 1, origin: { z: 1 } };
      submit(encoder => {
        encoder.copyBufferToTexture({ buffer, offset: 4, bytesPerRow: 256 }, texture, [2, 2]);
        encoder.copyTextureToTexture(texture, { texture: flat, origin: [1, 0, 0] }, new Uint32Array([2, 2, 1]));
      });
      expect(await rowsOf(flat)).toEqual([
        [0, 4, 5],
        [0, 10, 11],
      ]);
    });
  });

  describe("GPUBuffer", () => {
    test("reflects its descriptor, valid or not", async () => {
      let buffer!: GPUBuffer;
      expect(await validationError(() => (buffer = device.createBuffer({ size: 5, usage: 0xffffffff })))).toBeString();
      expect([buffer.size, buffer.usage, buffer.mapState]).toEqual([5, 0xffffffff, "unmapped"]);
    });

    test("is pending until the promise resolves", async () => {
      const buffer = device.createBuffer({ size: 16, usage: MAP_READ });
      const promise = buffer.mapAsync(READ);
      expect(buffer.mapState).toBe("pending");
      expect(() => buffer.getMappedRange()).toThrow(domException("OperationError"));
      expect(await promise).toBeUndefined();
      expect(buffer.mapState).toBe("mapped");
      buffer.unmap();
      expect(buffer.mapState).toBe("unmapped");
      expect(() => buffer.getMappedRange()).toThrow(domException("OperationError"));
    });

    test("getMappedRange() takes aligned ranges of the mapping that do not overlap", async () => {
      const buffer = bufferWith(new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7]), MAP_READ);
      await buffer.mapAsync(READ, 8, 16);
      expect(new Uint32Array(buffer.getMappedRange(16, 8))).toEqual(new Uint32Array([4, 5]));
      for (const [offset, size] of [
        [0],
        [0, 4],
        [8],
        [12, 4],
        [8, 2],
        [8, 12],
        [16, 4],
        [24, 4],
        [32],
        [2 ** 53 - 8, 4],
      ])
        expect(() => buffer.getMappedRange(offset, size)).toThrow(domException("OperationError"));
      expect(new Uint32Array(buffer.getMappedRange(8, 8))).toEqual(new Uint32Array([2, 3]));
      expect(buffer.getMappedRange(24, 0).byteLength).toBe(0);
    });

    test("getMappedRange() finds an overlap in whatever order the ranges were taken", () => {
      const buffer = device.createBuffer({ size: 64, usage: COPY_SRC, mappedAtCreation: true });
      const takes = (offset: number, size: number) => {
        try {
          return buffer.getMappedRange(offset, size).byteLength === size;
        } catch {
          return false;
        }
      };
      const ranges = [
        [40, 8, true],
        [8, 16, true],
        [24, 0, true],
        [40, 0, true],
        [32, 0, true],
        [16, 0, false],
        [24, 12, false],
        [0, 12, false],
        [0, 64, false],
        [40, 4, false],
        [24, 8, true],
        [32, 8, true],
        [48, 16, true],
        [0, 8, true],
        [56, 4, false],
      ] as const;
      expect(ranges.map(([offset, size]) => [offset, size, takes(offset, size)])).toEqual(ranges as any);
    });

    test("a mapping for writing shows what the last one left", async () => {
      const buffer = bufferWith(new Uint32Array([1, 2, 3, 4]), MAP_WRITE | COPY_SRC);
      await buffer.mapAsync(WRITE, 8);
      const tail = new Uint32Array(buffer.getMappedRange(8));
      expect([...tail]).toEqual([3, 4]);
      tail[0] = 30;
      buffer.unmap();
      await buffer.mapAsync(WRITE);
      expect([...new Uint32Array(buffer.getMappedRange())]).toEqual([1, 2, 30, 4]);
      buffer.unmap();
      expect([...new Uint32Array(await contentsOf(buffer))]).toEqual([1, 2, 30, 4]);
    });

    test("what is written to a mapping for reading is dropped", async () => {
      const buffer = bufferWith(new Uint32Array([1]), MAP_READ);
      for (let i = 0; i < 2; i++) {
        await buffer.mapAsync(READ);
        expect(new Uint32Array(buffer.getMappedRange())[0]++).toBe(1);
        buffer.unmap();
      }
    });

    test.each(["unmap", "destroy"] as const)("%s() detaches the ranges", method => {
      const buffer = device.createBuffer({ size: 16, usage: COPY_SRC, mappedAtCreation: true });
      const ranges = [buffer.getMappedRange(0, 8), buffer.getMappedRange(8, 0), buffer.getMappedRange(8)];
      const views = [new Uint8Array(ranges[0]), new Float32Array(ranges[2], 4), Buffer.from(ranges[0])];
      buffer[method]();
      expect(ranges.map(range => range.detached)).toEqual([true, true, true]);
      expect(views.map(view => view.length)).toEqual([0, 0, 0]);
      expect(buffer.mapState).toBe("unmapped");
    });

    test.each(["unmap", "destroy"] as const)("%s() rejects a pending mapping at once", async method => {
      const buffer = device.createBuffer({ size: 16, usage: MAP_READ });
      const promise = buffer.mapAsync(READ);
      buffer[method]();
      expect(buffer.mapState).toBe("unmapped");
      expect(Bun.peek.status(promise)).toBe("rejected");
      await expect(promise).rejects.toEqual(domException("AbortError"));
    });

    test("the end of a canceled mapping does not settle the next one", async () => {
      const buffer = bufferWith(new Uint32Array([1, 2, 3, 4]), MAP_READ);
      const canceled = buffer.mapAsync(READ, 0, 8);
      buffer.unmap();
      const [first, second] = await Promise.allSettled([canceled, buffer.mapAsync(READ, 8, 8)]);
      expect([first.status, second.status, buffer.mapState]).toEqual(["rejected", "fulfilled", "mapped"]);
      expect([...new Uint32Array(buffer.getMappedRange(8))]).toEqual([3, 4]);
    });

    test("mapAsync() of a buffer that is pending or mapped fails and leaves it so", async () => {
      const buffer = device.createBuffer({ size: 16, usage: MAP_READ });
      const first = buffer.mapAsync(READ);
      for (const state of ["pending", "mapped"]) {
        device.pushErrorScope("validation");
        const second = buffer.mapAsync(READ);
        expect([Bun.peek.status(second), buffer.mapState]).toEqual(["rejected", state]);
        await expect(second).rejects.toEqual(domException("OperationError"));
        expect(await device.popErrorScope()).toBeInstanceOf(GPUValidationError);
        await first;
      }
    });

    test.each([
      [WRITE, 0, 4],
      [READ | WRITE, 0, 4],
      [0, 0, 4],
      [READ, 4, 4],
      [READ, 0, 2],
      [READ, 24, undefined],
      [READ, 2 ** 53 - 8, 2 ** 53 - 4],
    ])("mapAsync(%p, %p, %p) is invalid", async (mode, offset, size) => {
      const buffer = device.createBuffer({ size: 16, usage: MAP_READ });
      const map = () => expect(buffer.mapAsync(mode, offset, size)).rejects.toEqual(domException("OperationError"));
      expect(await validationError(map)).toBeString();
      expect(buffer.mapState).toBe("unmapped");
    });

    test("mappedAtCreation", async () => {
      for (const size of [2, 2 ** 53 - 4])
        expect(() => device.createBuffer({ size, usage: COPY_SRC, mappedAtCreation: true })).toThrow(RangeError);
      const invalid = () => {
        const buffer = device.createBuffer({ size: 8, usage: 0, mappedAtCreation: true });
        expect([...new Uint8Array(buffer.getMappedRange()).fill(1, 4)]).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
        buffer.unmap();
      };
      expect(await validationError(invalid)).toBeString();
    });

    test("a range cannot be taken from its buffer", async () => {
      const buffer = device.createBuffer({ size: 4, usage: COPY_SRC, mappedAtCreation: true });
      const range = buffer.getMappedRange();
      const { port1, port2 } = new MessageChannel();
      expect(() => structuredClone(range, { transfer: [range] })).toThrow(TypeError);
      expect(() => port1.postMessage(range, [range])).toThrow(TypeError);
      port1.close();
      port2.close();
      const stream = new ReadableStream({ type: "bytes" });
      await expect(stream.getReader({ mode: "byob" }).read(new Uint8Array(range))).rejects.toThrow(TypeError);
      new Uint8Array(range.transfer()).fill(1);
      expect(structuredClone(range).byteLength).toBe(4);

      expect(range.detached).toBe(false);
      new Uint8Array(range)[0] = 2;
      buffer.unmap();
      expect([...new Uint8Array(await contentsOf(buffer))]).toEqual([2, 0, 0, 0]);
    });

    test("a range keeps its buffer, and is collected without harm to it", async () => {
      const range = device.createBuffer({ size: 4096, usage: COPY_SRC, mappedAtCreation: true }).getMappedRange();
      const buffer = device.createBuffer({ size: 4096, usage: COPY_SRC, mappedAtCreation: true });
      (() => void new Uint8Array(buffer.getMappedRange()).fill(7))();
      Bun.gc(true);
      expect(new Uint8Array(range).fill(1).length).toBe(4096);
      buffer.unmap();
      expect(new Uint8Array(await contentsOf(buffer))).toEqual(new Uint8Array(4096).fill(7));
    });

    test("another thread that reads a range when it is unmapped finds what it was given", async () => {
      using dir = tempDir("webgpu", {});
      const size = 1 << 20;
      const buffer = device.createBuffer({ size, usage: MAP_WRITE | COPY_SRC, mappedAtCreation: true });
      const written = writeFile(join(String(dir), "range"), new Uint8Array(buffer.getMappedRange()).fill(1));
      buffer.unmap();
      await buffer.mapAsync(WRITE);
      const next = new Uint8Array(buffer.getMappedRange());
      expect([next[0], next.at(-1)]).toEqual([1, 1]);
      next.fill(2);
      buffer.destroy();
      await written;
      expect(readFileSync(join(String(dir), "range")).equals(Buffer.alloc(size, 1))).toBe(true);
    });
  });

  describe("GPUTexture", () => {
    test("reflects its descriptor", () => {
      const reflect = (descriptor: GPUTextureDescriptor) => {
        const texture = device.createTexture(descriptor);
        texture.destroy();
        const keys = Object.keys(GPUTexture.prototype).filter(key => typeof texture[key] !== "function");
        return Object.fromEntries(keys.map(key => [key, texture[key]]));
      };
      expect(reflect({ size: [5], format: "r8unorm", usage: TEXTURE_BINDING })).toEqual({
        width: 5,
        height: 1,
        depthOrArrayLayers: 1,
        mipLevelCount: 1,
        sampleCount: 1,
        dimension: "2d",
        format: "r8unorm",
        usage: TEXTURE_BINDING,
        textureBindingViewDimension: undefined,
        label: "",
      });
      expect(
        reflect({
          label: "volume",
          size: { width: 4, height: 3, depthOrArrayLayers: 2 },
          mipLevelCount: 2,
          dimension: "3d",
          format: "rgba8unorm",
          viewFormats: ["rgba8unorm-srgb"],
          usage: TEXTURE_BINDING,
        }),
      ).toMatchObject({
        width: 4,
        height: 3,
        depthOrArrayLayers: 2,
        mipLevelCount: 2,
        dimension: "3d",
        label: "volume",
      });
    });

    test("createView()", async () => {
      const texture = device.createTexture({ size: [4, 4, 6], format: "r8unorm", usage: TEXTURE_BINDING });
      expect(texture.createView({ dimension: "cube", swizzle: "rgba" })).toBeInstanceOf(GPUTextureView);
      for (const swizzle of ["", "rgb", "rgbaa", "RGBA", "rgb2", "rgbé"])
        expect(() => texture.createView({ swizzle })).toThrow(TypeError);
      expect(await validationError(() => texture.createView({ swizzle: "bgra" }))).toBeString();
      // What the C API takes for a number that was left out.
      expect(await validationError(() => texture.createView({ mipLevelCount: 0xffffffff }))).toBeString();
      expect(await validationError(() => texture.createView({ arrayLayerCount: 0xffffffff }))).toBeString();
    });
  });

  describe("GPUShaderModule", () => {
    test("getCompilationInfo() counts in UTF-16 code units", async () => {
      let module!: GPUShaderModule;
      const code = "/* 😀 */\n/* é😀 */ fn main() { oops; }";
      expect(await validationError(() => (module = device.createShaderModule({ code })))).toContain("WGSL");
      const info = await module.getCompilationInfo();
      expect(info.messages).toBe(info.messages);
      expect(Object.isFrozen(info.messages)).toBe(true);
      const [{ type, lineNum, linePos, offset, length, message }] = info.messages;
      expect({ type, lineNum, linePos, offset, length, message }).toEqual({
        type: "error",
        lineNum: 2,
        linePos: code.split("\n")[1].indexOf(";") + 1,
        offset: code.indexOf(";"),
        length: 1,
        message: expect.any(String),
      });
      expect((await device.createShaderModule({ code: emptyShader }).getCompilationInfo()).messages).toEqual([]);
    });

    test("the code does not end at a null character", async () => {
      expect(await validationError(() => device.createShaderModule({ code: emptyShader + "\0" }))).toBeString();
    });
  });

  describe("arguments", () => {
    test("a format, a query type or a blend factor of a feature that the device lacks is a TypeError", async () => {
      const module = device.createShaderModule({
        code: "@vertex fn v() -> @builtin(position) vec4f { return vec4f(); } @fragment fn f() {}",
      });
      const pipeline = (rest: object) => ({ layout: "auto", vertex: { module }, ...rest }) as const;
      const texture = device.createTexture({ size: [4, 4], format: "r8unorm", usage: TEXTURE_BINDING });
      for (const format of [
        "depth32float-stencil8",
        "r16unorm",
        "rgba16snorm",
        "bc1-rgba-unorm",
        "bc7-rgba-unorm-srgb",
        "etc2-rgb8unorm",
        "eac-rg11snorm",
        "astc-4x4-unorm",
        "astc-12x12-unorm-srgb",
      ] as const) {
        for (const action of [
          () => device.createTexture({ size: [12, 12], format, usage: TEXTURE_BINDING }),
          () => device.createTexture({ size: [1], format: "r8unorm", viewFormats: [format], usage: TEXTURE_BINDING }),
          () => texture.createView({ format }),
          () => device.createBindGroupLayout({ entries: [{ binding: 0, visibility: 0, storageTexture: { format } }] }),
          () => device.createRenderBundleEncoder({ colorFormats: [format] }),
          () => device.createRenderBundleEncoder({ colorFormats: [], depthStencilFormat: format }),
          () => device.createRenderPipeline(pipeline({ depthStencil: { format } })),
          () => device.createRenderPipeline(pipeline({ fragment: { module, targets: [{ format }] } })),
        ])
          expect(action).toThrow(TypeError);
        await expect(device.createRenderPipelineAsync(pipeline({ depthStencil: { format } }))).rejects.toThrow(
          TypeError,
        );
      }
      expect(() => device.createTexture({ size: [4, 4], format: "bc1-rgba-unorm", usage: 1 })).toThrow(
        `The texture format "bc1-rgba-unorm" requires the feature "texture-compression-bc", which the device was not created with`,
      );
      expect(() => device.createQuerySet({ type: "timestamp", count: 1 })).toThrow(TypeError);
      const blend = { color: {}, alpha: { dstFactor: "one-minus-src1-alpha" } };
      expect(() =>
        device.createRenderPipeline(pipeline({ fragment: { module, targets: [{ format: "r8unorm", blend }] } })),
      ).toThrow(TypeError);
    });

    test("a sequence that stands for a dictionary has the right length", () => {
      const texture = device.createTexture({ size: [1], format: "r8unorm", usage: RENDER_ATTACHMENT });
      for (const action of [
        () => device.createTexture({ size: [], format: "r8unorm", usage: 1 }),
        () => device.createTexture({ size: [1, 1, 1, 1], format: "r8unorm", usage: 1 }),
        () => device.queue.writeTexture({ texture, origin: [0, 0, 0, 0] }, new Uint8Array(1), {}, [1]),
        () =>
          device.createCommandEncoder().beginRenderPass({
            colorAttachments: [{ view: texture, clearValue: [0, 0, 0], loadOp: "clear", storeOp: "store" }],
          }),
      ])
        expect(action).toThrow(TypeError);
    });

    test.each([9, 255, 256, 257, 264])("%p color formats are too many", async length => {
      const colorFormats = Array(length).fill(null);
      const create = () => device.createRenderBundleEncoder({ colorFormats, depthStencilFormat: "depth16unorm" });
      expect(await validationError(create)).toContain("exceeds");
    });

    test("an object of another class is refused", () => {
      const sampler = device.createSampler() as any;
      for (const action of [
        () => device.queue.submit([sampler]),
        () => device.createPipelineLayout({ bindGroupLayouts: [sampler] }),
        () => device.createBindGroup({ layout: sampler, entries: [] }),
        () => device.createComputePipeline({ layout: sampler, compute: { module: sampler } }),
        () => device.createCommandEncoder().clearBuffer(sampler),
      ])
        expect(action).toThrow(TypeError);
    });

    test("data that a conversion detaches or shrinks is read as it is afterwards", () => {
      const buffer = device.createBuffer({ size: 64, usage: COPY_DST });
      const after = (action: () => void, value: number) => ({ valueOf: () => (action(), value) }) as any as number;
      const detached = new Uint32Array(16);
      const resizable = new ArrayBuffer(64, { maxByteLength: 64 });
      for (const [data, size] of [
        [detached, after(() => detached.buffer.transfer(), 16)],
        [resizable, after(() => resizable.resize(0), 64)],
      ] as const)
        expect(() => device.queue.writeBuffer(buffer, 0, data, 0, size)).toThrow(domException("OperationError"));

      const offsets = new Uint32Array(4);
      const pass = device.createCommandEncoder().beginComputePass();
      const count = after(() => offsets.buffer.transfer(), 4);
      expect(() => pass.setBindGroup(0, null, offsets, 0, count)).toThrow(RangeError);

      const mapped = device.createBuffer({ size: 4, usage: COPY_SRC, mappedAtCreation: true });
      expect(() => mapped.getMappedRange(after(() => mapped.unmap(), 0))).toThrow(domException("OperationError"));
    });

    test("what only a getter returned lives until the call ends", () => {
      const bindings = [0, 1, 2];
      const layout = device.createBindGroupLayout({
        entries: bindings.map(binding => ({ binding, visibility: COMPUTE, buffer: { type: "storage" } })),
      });
      const resource = {
        get buffer() {
          return device.createBuffer({ size: 4, usage: STORAGE });
        },
        get size() {
          Bun.gc(true);
          return 4;
        },
      };
      device.createBindGroup({ layout, entries: bindings.values().map(binding => ({ binding, resource })) });
    });
  });

  test("every object has a label, which error messages use", async () => {
    const texture = device.createTexture({ size: [1], format: "r8unorm", usage: RENDER_ATTACHMENT });
    const module = device.createShaderModule({ code: emptyShader });
    const layout = device.createBindGroupLayout({ entries: [] });
    const label = "é\0😀\ud800";
    for (const object of [
      device.createBuffer({ label, size: 4, usage: COPY_SRC }),
      device.createTexture({ label, size: [1], format: "r8unorm", usage: TEXTURE_BINDING }),
      texture.createView({ label }),
      device.createSampler({ label }),
      device.createBindGroupLayout({ label, entries: [] }),
      device.createBindGroup({ label, layout, entries: [] }),
      device.createPipelineLayout({ label, bindGroupLayouts: [] }),
      device.createShaderModule({ label, code: emptyShader }),
      device.createComputePipeline({ label, layout: "auto", compute: { module } }),
      device.createQuerySet({ label, type: "occlusion", count: 1 }),
      device.createCommandEncoder({ label }),
      device.createCommandEncoder().finish({ label }),
      device.createCommandEncoder().beginComputePass({ label }),
      device.createCommandEncoder().beginRenderPass({
        label,
        colorAttachments: [{ view: texture, loadOp: "load", storeOp: "store" }],
      }),
      device.createRenderBundleEncoder({ label, colorFormats: ["r8unorm"] }),
    ]) {
      expect(object.label).toBe(label.toWellFormed());
      object.label = "changed";
      expect(object.label).toBe("changed");
    }

    const buffer = device.createBuffer({ label: "before", size: 4, usage: COPY_SRC });
    const write = () => device.queue.writeBuffer(buffer, 0, new Uint8Array(4));
    expect(await validationError(write)).toContain(`"before"`);
    buffer.label = "after";
    expect(await validationError(write)).toContain(`"after"`);
  });

  test("debug groups", async () => {
    submit(encoder => {
      encoder.pushDebugGroup("group");
      encoder.insertDebugMarker("");
      encoder.popDebugGroup();
    });
    expect(await validationError(() => device.createCommandEncoder().finish())).toBeUndefined();
    const unbalanced = device.createCommandEncoder();
    unbalanced.popDebugGroup();
    expect(await validationError(() => unbalanced.finish())).toBeString();
  });

  test("promises settle in the order of the queue, each in a task of its own", async () => {
    const buffer = device.createBuffer({ size: 4, usage: MAP_READ | COPY_DST });
    submit(encoder => encoder.clearBuffer(buffer));
    const order: string[] = [];
    const note = (name: string) => async () => {
      order.push(name);
      await null;
      order.push(`after ${name}`);
    };
    await Promise.all([buffer.mapAsync(READ).then(note("map")), device.queue.onSubmittedWorkDone().then(note("done"))]);
    expect(order).toEqual(["map", "after map", "done", "after done"]);
  });

  describe.each([
    ["onSubmittedWorkDone()", () => device.queue.onSubmittedWorkDone()],
    ["requestAdapter()", () => navigator.gpu.requestAdapter({ featureLevel: "none" })],
  ])("loops that wait for nothing but %s", (_, wait) => {
    test.each([
      ["a timer", () => new Promise(resolve => setTimeout(resolve, 0))],
      ["a mapping", () => device.createBuffer({ size: 4, usage: MAP_READ }).mapAsync(READ)],
    ])("give way to %s", async (_, start) => {
      let started: Promise<unknown> | undefined;
      let done = false;
      const loop = async () => {
        for (let i = 0; i < 10_000 && !done; i++) {
          await wait();
          started ??= start().then(() => (done = true));
        }
        return done;
      };
      expect(await Promise.all([loop(), loop()])).toEqual([true, true]);
    });
  });
});

describe.skipIf(!hasAdapter)("errors", () => {
  const causeError = (device: GPUDevice) => device.createBuffer({ size: 4, usage: 0 });

  test("go to the innermost scope that matches", async () => {
    const device = await requestDevice();
    device.pushErrorScope("validation");
    device.pushErrorScope("internal");
    device.pushErrorScope("out-of-memory");
    causeError(device);
    expect(await Promise.all([device.popErrorScope(), device.popErrorScope(), device.popErrorScope()])).toEqual([
      null,
      null,
      expect.any(GPUValidationError),
    ]);
    await expect(device.popErrorScope()).rejects.toEqual(domException("OperationError"));
    expect(() => device.pushErrorScope("other" as any)).toThrow(TypeError);
    device.destroy();
  });

  test("that no scope captures are events", async () => {
    const device = await requestDevice();
    const events: GPUUncapturedErrorEvent[] = [];
    device.onuncapturederror = event => events.push(event);
    causeError(device);
    expect(events).toEqual([]);
    device.addEventListener("uncapturederror", event => event.preventDefault());
    causeError(device);
    // An error comes before what was asked for after it.
    await device.queue.onSubmittedWorkDone();
    expect(events).toHaveLength(2);
    const [{ type, target, isTrusted, cancelable, defaultPrevented, error }] = events;
    expect({ type, isTrusted, cancelable, defaultPrevented }).toEqual({
      type: "uncapturederror",
      isTrusted: true,
      cancelable: true,
      defaultPrevented: true,
    });
    expect(target).toBe(device);
    expect(error).toBeInstanceOf(GPUValidationError);
    expect(error.message).toContain("usage");
    device.destroy();
  });
});

describe.skipIf(!hasAdapter)("destroy()", () => {
  test("unmaps every buffer at once and resolves lost", async () => {
    const device = await requestDevice();
    const mapped = Array.from({ length: 20 }, () =>
      device.createBuffer({ size: 4, usage: MAP_READ, mappedAtCreation: true }),
    );
    mapped.splice(0, 10).forEach(buffer => buffer.unmap());
    const ranges = mapped.map(buffer => buffer.getMappedRange());
    const pending = device.createBuffer({ size: 4, usage: MAP_READ });
    const promise = pending.mapAsync(READ);
    const { lost } = device;

    device.destroy();
    device.destroy();
    expect(ranges.filter(range => !range.detached)).toEqual([]);
    expect([pending.mapState, Bun.peek.status(promise), Bun.peek.status(lost)]).toEqual([
      "unmapped",
      "rejected",
      "pending",
    ]);
    await expect(promise).rejects.toEqual(domException("AbortError"));
    expect(device.lost).toBe(lost);
    expect(await lost).toBeInstanceOf(GPUDeviceLostInfo);
    expect((await lost).reason).toBe("destroyed");
  });

  test("lost is resolved when it is first read afterwards", async () => {
    const device = await requestDevice();
    device.destroy();
    await device.queue.onSubmittedWorkDone();
    expect(Bun.peek.status(device.lost)).toBe("fulfilled");
  });

  test("leaves a device that reports no error and settles every promise", async () => {
    const device = await requestDevice();
    const module = device.createShaderModule({ code: emptyShader });
    const compiling = device.createComputePipelineAsync({ layout: "auto", compute: { module } });
    const listener = (device.onuncapturederror = jest.fn());
    device.destroy();
    device.createBuffer({ size: 4, usage: 0 });

    device.pushErrorScope("validation");
    device.createBuffer({ size: 4, usage: 0 });
    device.queue.submit([device.createCommandEncoder().finish()]);
    expect(await device.popErrorScope()).toBeNull();
    expect(await compiling).toBeInstanceOf(GPUComputePipeline);
    expect(await device.createComputePipelineAsync({ layout: "auto", compute: { module } })).toBeInstanceOf(
      GPUComputePipeline,
    );
    expect(await module.getCompilationInfo()).toBeInstanceOf(GPUCompilationInfo);
    expect(await device.queue.onSubmittedWorkDone()).toBeUndefined();
    await expect(device.createBuffer({ size: 4, usage: MAP_READ }).mapAsync(READ)).rejects.toEqual(
      domException("AbortError"),
    );
    const mapped = device.createBuffer({ size: 4, usage: COPY_SRC, mappedAtCreation: true });
    const range = mapped.getMappedRange();
    expect(range.byteLength).toBe(4);
    mapped.unmap();
    expect(range.detached).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });

  test("in a getter of a descriptor, or in a listener", async () => {
    const first = await requestDevice();
    const descriptor = {
      get size() {
        first.destroy();
        return 4;
      },
      usage: COPY_SRC,
    };
    expect(first.createBuffer(descriptor).size).toBe(4);

    const second = await requestDevice();
    second.onuncapturederror = event => (event.preventDefault(), second.destroy());
    second.createBuffer({ size: 4, usage: 0 });
    expect((await second.lost).reason).toBe("destroyed");
  });
});
