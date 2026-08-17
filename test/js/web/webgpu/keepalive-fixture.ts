// Spawned by webgpu.test.ts. The completions awaited below are delivered by the
// Metal backend from its own threads; nothing else is pending in this process,
// so it only prints all three lines if the pending operations themselves keep
// the event loop alive (GPUEventLoopKeepAlive). It must also exit on its own
// afterwards.
const adapter = await navigator.gpu!.requestAdapter();
const device = await adapter!.requestDevice();

const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
device.queue.writeBuffer(buffer, 0, new Uint32Array([1, 2, 3, 4]));
device.queue.submit([]);
console.log("submitted");

await device.queue.onSubmittedWorkDone();
console.log("work done");

await buffer.mapAsync(GPUMapMode.READ);
console.log("mapped", new Uint32Array(buffer.getMappedRange()).length);
buffer.unmap();
