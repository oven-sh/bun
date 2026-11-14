import { expectType } from "./utilities";

expectType(navigator.gpu).is<GPU>();

const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
expectType(adapter).is<GPUAdapter | null>();
expectType(adapter!.features.has("shader-f16")).is<boolean>();
expectType([...adapter!.features]).is<string[]>();

const device = await adapter!.requestDevice({
  requiredFeatures: ["timestamp-query"],
  requiredLimits: { maxBufferSize: adapter!.limits.maxBufferSize },
});
expectType(device).is<GPUDevice>();
expectType(device.lost).is<Promise<GPUDeviceLostInfo>>();
device.addEventListener("uncapturederror", event => expectType(event.error).is<GPUError>());
device.addEventListener("other", event => expectType(event).is<Event>());

const descriptor: GPUBufferDescriptor = { size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST };
const buffer = device.createBuffer(descriptor);
await buffer.mapAsync(GPUMapMode.READ);
expectType(buffer.getMappedRange()).is<ArrayBuffer>();
device.queue.writeBuffer(buffer, 0, new Float32Array(4));

const format: Bun.WebGPU.GPUTextureFormat = "rgba8unorm";
const texture = device.createTexture({ size: [1, 1], format, usage: GPUTextureUsage.RENDER_ATTACHMENT });
// @ts-expect-error
device.createTexture({ size: [1, 1], format: "rgba8", usage: 0 });
// @ts-expect-error
device.createTexture({ size: [1, 1], usage: 0 });

const module = device.createShaderModule({ code: "" });
const pipeline = await device.createRenderPipelineAsync({
  layout: "auto",
  vertex: { module, buffers: [null] },
  fragment: { module, targets: [{ format, writeMask: GPUColorWrite.ALL }] },
});
expectType(pipeline).is<GPURenderPipeline>();

const encoder = device.createCommandEncoder();
const pass = encoder.beginRenderPass({
  colorAttachments: [{ view: texture.createView(), clearValue: [0, 0, 0, 1], loadOp: "clear", storeOp: "store" }],
});
pass.setPipeline(pipeline);
pass.setBindGroup(0, null);
pass.setBindGroup(0, null, new Uint32Array(1), 0, 1);
pass.end();
encoder.copyBufferToBuffer(buffer, buffer);
encoder.copyBufferToBuffer(buffer, 0, buffer, 0, 4);
device.queue.submit([encoder.finish()]);

device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {} }] });

declare const unknown: unknown;
if (unknown instanceof GPUBuffer) expectType(unknown).is<GPUBuffer>();
if (unknown instanceof GPUPipelineError) expectType(unknown.reason).is<"validation" | "internal">();

expectType(new GPUValidationError("message")).is<GPUValidationError>();
expectType(new GPUPipelineError("message", { reason: "internal" })).is<GPUPipelineError>();
expectType(
  new GPUUncapturedErrorEvent("uncapturederror", { error: new GPUOutOfMemoryError(""), cancelable: true }),
).is<GPUUncapturedErrorEvent>();
