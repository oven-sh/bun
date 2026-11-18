import { expectType } from "./utilities";

// The same with and without lib.dom.d.ts, which has an ImageData of its own.
const frame = new ImageData(8, 5);
expectType(frame).is<ImageData>();
expectType(frame.data).is<Uint8ClampedArray<ArrayBuffer>>();
expectType(frame.width).is<number>();
expectType(frame.height).is<number>();
expectType<Bun.Image.ColorSpace>(frame.colorSpace);
expectType(new ImageData(8, 5, { colorSpace: "display-p3" })).is<ImageData>();
expectType(new ImageData(new Uint8ClampedArray(16), 2)).is<ImageData>();
expectType(new ImageData(new Uint8ClampedArray(16), 2, 2, { colorSpace: "srgb" })).is<ImageData>();
expectType(structuredClone(frame)).is<ImageData>();
// @ts-expect-error
new ImageData(8);
// @ts-expect-error
new ImageData(new Uint8Array(16), 2, 2);
// @ts-expect-error
new ImageData(8, 5, { colorSpace: "rec2020" });
// @ts-expect-error
frame.width = 1;

// With lib.dom.d.ts, this depends on its version.
declare const ImageDataOfBun: Bun.__internal.LibDomIsLoaded extends true ? any : typeof ImageData;
expectType<"rgba-unorm8">(new ImageDataOfBun(8, 5).pixelFormat);
expectType<"rgba-unorm8">(new ImageDataOfBun(8, 5, { colorSpace: "srgb-linear" }).pixelFormat);
expectType<"rgba-float16">(new ImageDataOfBun(8, 5, { pixelFormat: "rgba-float16" }).pixelFormat);
expectType<Float16Array>(new ImageDataOfBun(8, 5, { pixelFormat: "rgba-float16" }).data);
expectType<Float16Array>(new ImageDataOfBun(new Float16Array(4), 1, undefined, { pixelFormat: "rgba-float16" }).data);

const plain = { data: Buffer.alloc(16), width: 2, height: 2, name: "plain" };
const image = new Bun.Image(frame, { maxPixels: 100 });
new Bun.Image(plain);
// @ts-expect-error
new Bun.Image({ data: new Float32Array(16), width: 2, height: 2 });
// @ts-expect-error
new Bun.Image({ data: new Uint8Array(16), width: 2 });

expectType(image.imageData()).is<Promise<ImageData>>();
expectType(image.imageData({ colorSpace: "display-p3-linear" })).is<Promise<ImageData>>();
expectType(image.imageData(frame)).is<Promise<ImageData>>();
expectType(image.imageData(plain)).is<Promise<typeof plain>>();
// @ts-expect-error
image.imageData({ colorSpace: "rec2020" });
// @ts-expect-error
image.imageData(new Uint8ClampedArray(16));

expectType<Bun.Image.Format>("raw");
expectType<Bun.Image.ErrorCode>("ERR_IMAGE_SIZE_MISMATCH");
