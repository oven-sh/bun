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
      isRangeError: err instanceof RangeError,
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
  const lib2 = gpu.library(/* metal */ `
    #include <metal_stdlib>
    using namespace metal;
    // [[stage_in]] vertex input spread over two buffers, for vertexLayout arrays.
    struct In { float2 position [[attribute(0)]]; float4 color [[attribute(1)]]; };
    struct Colored { float4 position [[position]]; float4 color; };
    vertex Colored vs_in(In in [[stage_in]]) { return { float4(in.position, 0.0, 1.0), in.color }; }
    fragment float4 passthrough(Colored in [[stage_in]]) { return in.color; }
    kernel void noop(device float* v [[buffer(0)]], uint i [[thread_position_in_grid]]) { v[i] = v[i]; }
  `);
  emit({
    step: "function types",
    vs: lib.function("vs").type,
    red: lib.function("red").type,
    noop: lib2.function("noop").type,
  });

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
  emit({
    step: "after commitAndWait",
    state: frame.state,
    gpuStatus: frame.gpuStatus,
    error: frame.error,
    inFlight: target.inFlight,
  });
  attempt("use after commit", () => frame.computePass());

  // commit() without waiting: readPixels waits for the frame by itself, and
  // gpuStatus reports completion without blocking afterwards.
  {
    const async = gpu.frame();
    async
      .renderPass({ color: target, clear: [0, 1, 0, 1] })
      .end()
      .commit();
    const px = target.readPixels();
    emit({ step: "commit then read", corner: Array.from(px.subarray(0, 4)), gpuStatus: async.gpuStatus });
  }

  // Two vertex buffers described by a vertexLayout array: positions in 0, colours in 1.
  {
    const positions = gpu.buffer(new Float32Array([0, 0.9, -0.9, -0.9, 0.9, -0.9]));
    const colors = gpu.buffer(new Float32Array([0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]));
    const layered = gpu.renderPipeline({
      vertex: lib2.function("vs_in"),
      fragment: lib2.function("passthrough"),
      colorFormats: ["bgra8unorm"],
      vertexLayout: [
        { stride: 8, attributes: [{ format: "float2" }] },
        { stride: 16, attributes: [{ format: "float4" }] },
      ],
    });
    gpu
      .frame()
      .renderPass({ color: target, clear: [0, 0, 0, 1] })
      .pipeline(layered)
      .vertexBuffer(0, positions)
      .vertexBuffer(1, colors)
      .draw(3)
      .end()
      .commitAndWait();
    const px = target.readPixels();
    emit({
      step: "two vertex buffers",
      center: Array.from(px.subarray(((size / 2) * size + size / 2) * 4, ((size / 2) * size + size / 2) * 4 + 4)),
    });
    attempt("attribute described twice", () =>
      gpu.renderPipeline({
        vertex: lib2.function("vs_in"),
        fragment: lib2.function("passthrough"),
        vertexLayout: [
          { stride: 8, attributes: [{ format: "float2", index: 0 }] },
          { stride: 16, attributes: [{ format: "float4", index: 0 }] },
        ],
      }),
    );
    attempt("bind offset equal to length", () =>
      gpu.frame().renderPass({ color: target }).pipeline(layered).vertexBuffer(0, positions, positions.byteLength),
    );
    attempt("bind offset misaligned", () =>
      gpu.frame().renderPass({ color: target }).pipeline(layered).vertexBuffer(0, positions, 2),
    );
  }

  attempt("kernel as vertex function", () => gpu.renderPipeline({ vertex: lib2.function("noop") }));
  attempt("vertex function as kernel", () => gpu.computePipeline(lib.function("vs")));

  {
    const scratch = gpu.buffer(16);
    scratch.destroy();
    emit({ step: "destroyed", destroyed: scratch.destroyed, byteLength: scratch.byteLength });
    attempt("write after destroy", () => scratch.write(new Uint8Array(4)));
  }
  attempt("bytesPerRow not whole pixels", () => target.replace(new Uint8Array(size * size * 4 + size), size * 4 + 2));
  attempt("mipmaps of an integer format", () => {
    const ints = gpu.texture({ width: 4, height: 4, format: "r32uint", mipmapped: true });
    gpu.frame().blit().generateMipmaps(ints);
  });
  {
    // gpu.frame() refuses before Metal's own limit would block the thread.
    const open: unknown[] = [];
    let threw: string | null = null;
    try {
      for (let i = 0; i < 40; i++) open.push(gpu.frame());
    } catch (e) {
      threw = String((e as Error)?.message);
    }
    emit({ step: "open frame limit", opened: open.length, threw });
    for (const f of open as { commit(): void }[]) f.commit();
  }

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
