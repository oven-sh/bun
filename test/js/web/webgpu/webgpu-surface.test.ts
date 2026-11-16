import { dlopen, FFIType } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { isMacOS } from "harness";

// bun-types does not declare the WebGPU globals, so this file reads them untyped.
const { UnsafeWindowSurface, GPUCanvasContext, GPUTexture, GPUTextureUsage } = globalThis as any;
const gpu = (navigator as any).gpu;
const hasAdapter = (await gpu.requestAdapter()) !== null;

describe("UnsafeWindowSurface", () => {
  test("is a global, GPUCanvasContext has no public constructor", () => {
    expect(typeof UnsafeWindowSurface).toBe("function");
    expect(typeof GPUCanvasContext).toBe("function");
    expect(() => new GPUCanvasContext()).toThrow();
  });

  test("checks its options", () => {
    expect(() => new UnsafeWindowSurface()).toThrow(TypeError);
    expect(
      () => new UnsafeWindowSurface({ system: "wayland", windowHandle: 1, displayHandle: 1, width: 1, height: 1 }),
    ).toThrow("UnsafeWindowSurface: system 'wayland' is not supported on this platform");
  });

  test.skipIf(!isMacOS)("needs pointers for its handles", () => {
    for (const handle of [0, -1, 1.5, "1", null, undefined]) {
      expect(
        () => new UnsafeWindowSurface({ system: "cocoa", windowHandle: 1, displayHandle: handle, width: 1, height: 1 }),
      ).toThrow("UnsafeWindowSurface: displayHandle is not a pointer");
    }
  });
});

// An NSView that is in no window: a CAMetalLayer on it gives frames without anything on screen.
function makeView(): number {
  // Loads AppKit, where NSView lives.
  dlopen("/System/Library/Frameworks/AppKit.framework/AppKit", {
    NSApplicationLoad: { args: [], returns: FFIType.bool },
  });
  const objc = dlopen("/usr/lib/libobjc.A.dylib", {
    objc_getClass: { args: [FFIType.cstring], returns: FFIType.ptr },
    sel_registerName: { args: [FFIType.cstring], returns: FFIType.ptr },
    objc_msgSend: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  }).symbols;
  const cstr = (s: string) => Buffer.from(`${s}\0`);
  const NSView = objc.objc_getClass(cstr("NSView"));
  const view = objc.objc_msgSend(
    objc.objc_msgSend(NSView, objc.sel_registerName(cstr("alloc"))),
    objc.sel_registerName(cstr("init")),
  );
  return view as unknown as number;
}

describe.skipIf(!isMacOS || !hasAdapter)("UnsafeWindowSurface on an NSView", () => {
  test("draws, reads back and presents frames", async () => {
    const view = makeView();
    expect(view).not.toBe(0);
    const surface = new UnsafeWindowSurface({
      system: "cocoa",
      windowHandle: view,
      displayHandle: view,
      width: 8,
      height: 4,
    });
    const context = surface.getContext("webgpu");
    expect(context).toBeInstanceOf(GPUCanvasContext);
    expect(surface.getContext("webgpu")).toBe(context);
    expect(surface.getContext("2d")).toBeNull();
    expect(context.canvas).toBe(surface);
    expect(context.getConfiguration()).toBeNull();
    expect(() => context.getCurrentTexture()).toThrow("the context is not configured");

    const device = await (await gpu.requestAdapter()).requestDevice();
    const format = gpu.getPreferredCanvasFormat();
    context.configure({ device, format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    expect(context.getConfiguration()).toMatchObject({ device, format, alphaMode: "opaque", viewFormats: [] });

    const texture = context.getCurrentTexture();
    expect(texture).toBeInstanceOf(GPUTexture);
    expect(context.getCurrentTexture()).toBe(texture);
    expect([texture.width, texture.height, texture.format]).toEqual([8, 4, format]);

    const buffer = device.createBuffer({ size: 256 * 4, usage: 0x0001 | 0x0008 }); // MAP_READ | COPY_DST
    const encoder = device.createCommandEncoder();
    encoder
      .beginRenderPass({
        colorAttachments: [
          { view: texture.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 1, g: 0, b: 0, a: 1 } },
        ],
      })
      .end();
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: 256 }, [8, 4]);
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(1); // READ
    const pixel = [...new Uint8Array(buffer.getMappedRange(0, 4))];
    expect(pixel).toEqual(format === "bgra8unorm" ? [0, 0, 255, 255] : [255, 0, 0, 255]);
    buffer.unmap();

    surface.present();
    // The next frame is a new texture, and a new size reconfigures.
    surface.width = 16;
    const next = context.getCurrentTexture();
    expect(next).not.toBe(texture);
    expect([next.width, next.height]).toEqual([16, 4]);
    surface.present();

    context.unconfigure();
    expect(context.getConfiguration()).toBeNull();
    expect(() => context.getCurrentTexture()).toThrow("the context is not configured");
  });

  test("rejects an alpha mode that is not a GPUCanvasAlphaMode", async () => {
    const view = makeView();
    const surface = new UnsafeWindowSurface({
      system: "cocoa",
      windowHandle: view,
      displayHandle: view,
      width: 4,
      height: 4,
    });
    const device = await (await gpu.requestAdapter()).requestDevice();
    expect(() =>
      surface.getContext("webgpu").configure({ device, format: gpu.getPreferredCanvasFormat(), alphaMode: "straight" }),
    ).toThrow("'straight' is not a valid GPUCanvasAlphaMode");
  });
});
