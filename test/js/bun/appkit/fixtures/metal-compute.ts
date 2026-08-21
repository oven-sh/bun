import { gpu } from "bun:appkit";
import { emit, run } from "./_util";

await run(() => {
  if (!gpu.available) return emit({ step: "skip-no-gpu" });

  const lib = gpu.library(/* metal */ `
    #include <metal_stdlib>
    using namespace metal;
    kernel void twice(device float* values [[buffer(0)]], constant float& factor [[buffer(1)]],
                      uint i [[thread_position_in_grid]]) {
      values[i] *= factor;
    }
  `);
  const twice = gpu.computePipeline(lib.function("twice"));
  emit({
    step: "pipeline",
    widthPositive: twice.threadExecutionWidth > 0,
    maxAtLeastWidth: twice.maxTotalThreadsPerThreadgroup >= twice.threadExecutionWidth,
  });

  const input = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const buffer = gpu.buffer(input);
  gpu
    .frame()
    .computePass()
    .pipeline(twice)
    .buffer(0, buffer)
    .bytes(1, Float32Array.of(2))
    .dispatch(input.length)
    .end()
    .commitAndWait();
  emit({ step: "doubled", values: Array.from(new Float32Array(buffer.read().buffer)) });

  // A private buffer is filled and drained through blits.
  const hidden = gpu.buffer(input.byteLength, { storage: "private" });
  const back = gpu.buffer(input.byteLength);
  const frame = gpu.frame();
  frame.blit().copyBuffer(buffer, hidden);
  frame.computePass().pipeline(twice).buffer(0, hidden).bytes(1, Float32Array.of(10)).dispatch([input.length]);
  frame.blit().copyBuffer(hidden, back, { size: input.byteLength });
  frame.commitAndWait();
  emit({ step: "private", storage: hidden.storage, values: Array.from(new Float32Array(back.read().buffer)) });

  // commit() alone: read() waits for the frame that wrote the buffer.
  gpu
    .frame()
    .computePass()
    .pipeline(twice)
    .buffer(0, buffer)
    .bytes(1, Float32Array.of(0.5))
    .dispatch(input.length)
    .end()
    .commit();
  emit({
    step: "read after commit",
    values: Array.from(new Float32Array(buffer.read().buffer)),
    inFlightAfter: buffer.inFlight,
  });

  // "managed" is taken as "shared" for buffers.
  emit({ step: "managed alias", storage: gpu.buffer(4, { storage: "managed" as never }).storage });
});
