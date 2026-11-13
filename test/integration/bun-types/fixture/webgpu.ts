import { expectType } from "./utilities";

const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
expectType(adapter).is<GPUAdapter | null>();
const device = await adapter!.requestDevice({ requiredFeatures: ["shader-f16"] });
expectType(device.features.has("shader-f16")).is<boolean>();

const descriptor: GPUBufferDescriptor = { size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST };
const buffer: GPUBuffer = device.createBuffer(descriptor);
device.queue.writeBuffer(buffer, 0, new Float32Array(4));
await buffer.mapAsync(GPUMapMode.READ);
expectType(buffer.getMappedRange()).is<ArrayBuffer>();

const pipeline = await device.createComputePipelineAsync({
  layout: "auto",
  compute: { module: device.createShaderModule({ code: "" }), constants: { scale: 2 } },
});
const pass = device.createCommandEncoder().beginComputePass();
pass.setPipeline(pipeline);
pass.setBindGroup(
  0,
  device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer } }] }),
);

const format: Bun.WebGPU.GPUTextureFormat = "rgba8unorm";
device.createTexture({ size: [1, 1], format, usage: GPUTextureUsage.COPY_DST });
// @ts-expect-error not a format
device.createTexture({ size: [1, 1], format: "rgba", usage: 0 });

device.addEventListener("uncapturederror", event => expectType(event.error.message).is<string>());
new GPUValidationError("message") instanceof GPUError;
