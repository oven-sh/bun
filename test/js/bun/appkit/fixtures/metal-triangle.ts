import { gpu, GpuCompileError } from "bun:appkit";
import { emit, run } from "./_util";

function attempt(name: string, f: () => unknown) {
  try {
    f();
    emit({ step: name, threw: false });
  } catch (e) {
    const err = e as Error;
    emit({
      step: name,
      threw: true,
      name: err?.name,
      isCompileError: err instanceof GpuCompileError,
      isTypeError: err instanceof TypeError,
      message: String(err?.message),
    });
  }
}

await run(() => {
  if (!gpu.available) return emit({ step: "skip-no-gpu" });

  emit({ step: "device", name: typeof gpu.name, unifiedMemory: typeof gpu.unifiedMemory });

  const lib = gpu.library(/* metal */ `
    #include <metal_stdlib>
    using namespace metal;
    struct Out { float4 position [[position]]; };
    // Covers the centre of clip space but none of the corners.
    vertex Out vs(uint id [[vertex_id]]) {
      const float2 corners[] = { float2(0.0, 0.9), float2(-0.9, -0.9), float2(0.9, -0.9) };
      return { float4(corners[id], 0.0, 1.0) };
    }
    fragment float4 red(Out in [[stage_in]]) { return float4(1.0, 0.0, 0.0, 1.0); }
  `);
  emit({ step: "library", names: [...lib.functionNames].sort() });

  const size = 64;
  const target = gpu.texture({ width: size, height: size, format: "bgra8unorm", usage: ["render", "read"] });
  const pipeline = gpu.renderPipeline({
    vertex: lib.function("vs"),
    fragment: lib.function("red"),
    colorFormats: ["bgra8unorm"],
  });
  emit({
    step: "objects",
    texture: { width: target.width, height: target.height, format: target.format },
    pipeline: { colorFormats: pipeline.colorFormats, depthFormat: pipeline.depthFormat },
  });

  const frame = gpu.frame();
  frame
    .renderPass({ color: target, clear: [0, 0, 1, 1] })
    .pipeline(pipeline)
    .draw(3)
    .end()
    .commitAndWait();
  const pixels = target.readPixels();
  const at = (x: number, y: number) => Array.from(pixels.subarray((y * size + x) * 4, (y * size + x) * 4 + 4));
  emit({
    step: "pixels",
    byteLength: pixels.byteLength,
    // BGRA byte order: red is (0, 0, 255, 255), the blue clear colour is (255, 0, 0, 255).
    center: at(size / 2, size / 2),
    corner: at(0, 0),
    committed: frame.committed,
  });
  attempt("use after commit", () => frame.computePass());

  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const buffer = gpu.buffer(bytes.byteLength);
  buffer.write(bytes.subarray(4), 4);
  buffer.write(bytes.subarray(0, 4));
  emit({
    step: "buffer",
    byteLength: buffer.byteLength,
    roundTrip: Array.from(buffer.read()),
    tail: Array.from(buffer.read(6)),
  });
  attempt("buffer write out of bounds", () => buffer.write(bytes, 4));

  attempt("compile error", () => gpu.library("this is not metal"));
  attempt("no such function", () => lib.function("missing"));
  attempt("draw without pipeline", () => gpu.frame().renderPass({ color: target }).draw(3));
});
