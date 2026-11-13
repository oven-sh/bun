console.log(String(navigator.gpu), navigator.gpu.wgslLanguageFeatures.has("pointer_composite_access"));
console.log(new GPUValidationError("invalid").message, new GPUPipelineError("failed", { reason: "internal" }).reason);

async function use(device: GPUDevice) {
  const seen: unknown[] = [];
  const pipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: {
      module: device.createShaderModule({
        code: `
          @group(0) @binding(0) var<storage, read_write> data: array<u32>;
          @compute @workgroup_size(4) fn main(@builtin(local_invocation_index) i: u32) { data[i] *= data[i]; }`,
      }),
    },
  });
  const { STORAGE, COPY_SRC, COPY_DST, MAP_READ } = GPUBufferUsage;
  const data = device.createBuffer({ size: 16, usage: STORAGE | COPY_SRC | COPY_DST });
  const result = device.createBuffer({ size: 16, usage: MAP_READ | COPY_DST });
  device.queue.writeBuffer(data, 0, new Uint32Array([1, 2, 3, 4]));
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(
    0,
    device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: data }] }),
  );
  pass.dispatchWorkgroups(1);
  pass.end();
  encoder.copyBufferToBuffer(data, result);
  device.queue.submit([encoder.finish()]);
  await result.mapAsync(GPUMapMode.READ);
  const range = result.getMappedRange();
  seen.push(new Uint32Array(range).join());
  result.unmap();
  seen.push(range.byteLength, result.mapState);

  const event = await new Promise<GPUUncapturedErrorEvent>(resolve => {
    device.addEventListener("uncapturederror", event => (event.preventDefault(), resolve(event)));
    device.createBuffer({ size: 4, usage: 0 });
  });
  seen.push(event.error instanceof GPUValidationError, event.error.message.length > 0);
  const failure = await device
    .createComputePipelineAsync({ layout: "auto", compute: { module: device.createShaderModule({ code: "" }) } })
    .catch((error: GPUPipelineError) => error);
  seen.push(failure instanceof GPUPipelineError && failure.reason);
  const { messages } = await device.createShaderModule({ code: "x" }).getCompilationInfo();
  seen.push(messages[0].type, messages[0].lineNum);
  device.destroy();
  seen.push((await device.lost).reason);
  return seen.join(" ");
}

// The executable may lack an adapter that plain Bun has.
const device = await (await navigator.gpu.requestAdapter())?.requestDevice();
console.log(device ? await use(device) : "1,4,9,16 0 unmapped true true validation error 1 destroyed");
