import { describe, test, expect } from "bun:test";

// Only run on platforms where WebGPU is available
const hasGpu = typeof navigator !== "undefined" && navigator.gpu != null;

describe("WebGPU", () => {
  test("navigator.gpu exists", () => {
    expect(typeof navigator).toBe("object");
    expect(navigator.gpu).toBeDefined();
    expect(navigator.gpu).not.toBeNull();
  });

  test("requestAdapter resolves to a GPUAdapter or null", async () => {
    const adapter = await navigator.gpu.requestAdapter();
    // May be null on headless/CI machines with no GPU backend
    if (adapter === null) {
      console.log("No GPU adapter available, skipping remaining tests");
      return;
    }
    expect(adapter).toBeDefined();
    expect(typeof adapter.requestDevice).toBe("function");
  });

  test("requestDevice resolves to a GPUDevice", async () => {
    const adapter = await navigator.gpu.requestAdapter();
    if (adapter === null) return;

    const device = await adapter.requestDevice();
    expect(device).toBeDefined();
    expect(typeof device.createBuffer).toBe("function");
    expect(typeof device.createShaderModule).toBe("function");
    expect(typeof device.createComputePipeline).toBe("function");
    expect(typeof device.createCommandEncoder).toBe("function");
    expect(device.queue).toBeDefined();
    expect(typeof device.queue.submit).toBe("function");
    expect(typeof device.queue.writeBuffer).toBe("function");
  });

  test("createBuffer, writeBuffer, mapAsync, getMappedRange end-to-end", async () => {
    const adapter = await navigator.gpu.requestAdapter();
    if (adapter === null) return;
    const device = await adapter.requestDevice();

    const GPUBufferUsage = {
      MAP_READ: 0x0001,
      MAP_WRITE: 0x0002,
      COPY_SRC: 0x0004,
      COPY_DST: 0x0008,
      STORAGE: 0x0080,
    };

    // Create a small buffer that can be read back
    const readBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // writeBuffer needs COPY_DST (to receive queue.writeBuffer) and COPY_SRC (to be copyBufferToBuffer source)
    const writeBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });

    // Write data via queue.writeBuffer
    const inputData = new Float32Array([1.0, 2.0, 3.0, 4.0]);
    device.queue.writeBuffer(writeBuffer, 0, inputData);

    // Copy from writeBuffer to readBuffer
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(writeBuffer, 0, readBuffer, 0, 16);
    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);

    // Map and read back
    await readBuffer.mapAsync(GPUBufferUsage.MAP_READ);
    const result = readBuffer.getMappedRange();
    const data = new Float32Array(result);

    expect(data[0]).toBe(1.0);
    expect(data[1]).toBe(2.0);
    expect(data[2]).toBe(3.0);
    expect(data[3]).toBe(4.0);

    readBuffer.unmap();
    readBuffer.destroy();
    writeBuffer.destroy();
  });

  test("compute shader: multiply by 2", async () => {
    const adapter = await navigator.gpu.requestAdapter();
    if (adapter === null) return;
    const device = await adapter.requestDevice();

    const GPUBufferUsage = {
      MAP_READ: 0x0001,
      COPY_DST: 0x0008,
      STORAGE: 0x0080,
    };

    const GPUShaderStage = { COMPUTE: 4 };

    const shaderCode = `
      @group(0) @binding(0) var<storage, read> input: array<f32>;
      @group(0) @binding(1) var<storage, read_write> output: array<f32>;

      @compute @workgroup_size(4)
      fn main(@builtin(global_invocation_id) id: vec3<u32>) {
        output[id.x] = input[id.x] * 2.0;
      }
    `;

    const shaderModule = device.createShaderModule({ code: shaderCode });

    const inputData = new Float32Array([1.0, 2.0, 3.0, 4.0]);
    const bufferSize = inputData.byteLength;

    // inputBuffer: needs COPY_DST (for queue.writeBuffer) and STORAGE (for compute shader read)
    const inputBuffer = device.createBuffer({
      size: bufferSize,
      usage: 0x0008 | 0x0080, // COPY_DST | STORAGE
    });
    device.queue.writeBuffer(inputBuffer, 0, inputData);

    // outputBuffer: needs STORAGE (for compute shader write) and COPY_SRC (for copyBufferToBuffer)
    const outputBuffer = device.createBuffer({
      size: bufferSize,
      usage: 0x0080 | 0x0004, // STORAGE | COPY_SRC
    });

    const readBuffer = device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
      ],
    });

    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    const computePipeline = device.createComputePipeline({
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: "main",
      },
    });

    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: inputBuffer } },
        { binding: 1, resource: { buffer: outputBuffer } },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(computePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
    encoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, bufferSize);
    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);

    await readBuffer.mapAsync(GPUBufferUsage.MAP_READ);
    const result = new Float32Array(readBuffer.getMappedRange());

    expect(result[0]).toBe(2.0);
    expect(result[1]).toBe(4.0);
    expect(result[2]).toBe(6.0);
    expect(result[3]).toBe(8.0);

    readBuffer.unmap();
  });
});
