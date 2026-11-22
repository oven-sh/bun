// bun operator-new-probe-metalfx-fixture.ts
// Temporary, not for merge. The reproduction from the report behind oven-sh/bun#49416 (a MetalFX temporal scaler built
// through bun:ffi), with lines that say what the machine has. On a build without the fix the process is expected to
// abort with "LLVM ERROR: out of memory" while MetalFX prewarms the scaler on a background queue.
import { dlopen, FFIType, type Pointer } from "bun:ffi";

const LIBOBJC = "/usr/lib/libobjc.A.dylib";

const runtime = dlopen(LIBOBJC, {
  objc_getClass: { args: [FFIType.cstring], returns: FFIType.ptr },
  sel_registerName: { args: [FFIType.cstring], returns: FFIType.ptr },
  object_getClass: { args: [FFIType.ptr], returns: FFIType.ptr },
  class_respondsToSelector: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.bool },
}).symbols;

// objc_msgSend once per signature this needs.
const send = dlopen(LIBOBJC, { objc_msgSend: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr } }).symbols
  .objc_msgSend;
const sendForText = dlopen(LIBOBJC, { objc_msgSend: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.cstring } })
  .symbols.objc_msgSend;
const sendU64 = dlopen(LIBOBJC, {
  objc_msgSend: { args: [FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.void },
}).symbols.objc_msgSend;
const sendBool = dlopen(LIBOBJC, {
  objc_msgSend: { args: [FFIType.ptr, FFIType.ptr, FFIType.bool], returns: FFIType.void },
}).symbols.objc_msgSend;
const sendPtr = dlopen(LIBOBJC, {
  objc_msgSend: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
}).symbols.objc_msgSend;
const sendPtrForBool = dlopen(LIBOBJC, {
  objc_msgSend: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.bool },
}).symbols.objc_msgSend;

const metal = dlopen("/System/Library/Frameworks/Metal.framework/Metal", {
  MTLCreateSystemDefaultDevice: { args: [], returns: FFIType.ptr },
}).symbols;
// Loaded for its classes. MetalFX exports no C functions, so through libc's own dlopen.
const libc = dlopen("/usr/lib/libSystem.B.dylib", {
  dlopen: { args: [FFIType.cstring, FFIType.i32], returns: FFIType.ptr },
}).symbols;
const RTLD_NOW = 2;

const cls = (name: string) => runtime.objc_getClass(Buffer.from(`${name}\0`)) as Pointer;
const sel = (name: string) => runtime.sel_registerName(Buffer.from(`${name}\0`)) as Pointer;

function stop(reason: string): never {
  console.log(`stopped: ${reason}`);
  process.exit(0);
}

if (!libc.dlopen(Buffer.from("/System/Library/Frameworks/MetalFX.framework/MetalFX\0"), RTLD_NOW)) {
  stop("MetalFX.framework does not load");
}

const MTLPixelFormatRG16Float = 65;
const MTLPixelFormatRGBA16Float = 115;
const MTLPixelFormatDepth32Float = 252;

const device = metal.MTLCreateSystemDefaultDevice();
if (!device) stop("there is no Metal device");
console.log(`device: ${String(sendForText(send(device, sel("name")) as Pointer, sel("UTF8String")))}`);

const descriptorClass = cls("MTLFXTemporalScalerDescriptor");
if (!descriptorClass) stop("there is no MTLFXTemporalScalerDescriptor class");
const supportsDevice = sel("supportsDevice:");
if (runtime.class_respondsToSelector(runtime.object_getClass(descriptorClass), supportsDevice)) {
  const supported = sendPtrForBool(descriptorClass, supportsDevice, device);
  console.log(`supportsDevice: ${supported}`);
  if (!supported) stop("MetalFX does not support the device");
} else {
  console.log("supportsDevice: the class has no such method");
}

const descriptor = send(send(descriptorClass, sel("alloc")), sel("init")) as Pointer;
sendU64(descriptor, sel("setInputWidth:"), 960);
sendU64(descriptor, sel("setInputHeight:"), 540);
sendU64(descriptor, sel("setOutputWidth:"), 1920);
sendU64(descriptor, sel("setOutputHeight:"), 1080);
sendU64(descriptor, sel("setColorTextureFormat:"), MTLPixelFormatRGBA16Float);
sendU64(descriptor, sel("setDepthTextureFormat:"), MTLPixelFormatDepth32Float);
sendU64(descriptor, sel("setMotionTextureFormat:"), MTLPixelFormatRG16Float);
sendU64(descriptor, sel("setOutputTextureFormat:"), MTLPixelFormatRGBA16Float);
sendBool(descriptor, sel("setAutoExposureEnabled:"), false);

const started = performance.now();
const scaler = sendPtr(descriptor, sel("newTemporalScalerWithDevice:"), device);
console.log(`scaler: ${scaler ? "made" : "nil"} in ${Math.round(performance.now() - started)} ms`);

// MetalFX prewarms on a background queue and gives no signal when it is done.
for (let second = 1; second <= 8; second++) {
  await Bun.sleep(1000);
  console.log(`alive after ${second} s`);
}
console.log("done");
