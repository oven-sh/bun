const show = (image: ImageData) => console.log(image.width, image.height, image.colorSpace, image.data.join());
show(new ImageData(1, 2));
const wrapped = new ImageData(new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]), 2, 1, { colorSpace: "display-p3" });
show(wrapped);
show(structuredClone(wrapped));
const wide = new ImageData(1, 1, { pixelFormat: "rgba-float16" });
console.log((wide as any).pixelFormat, wide.data.constructor.name, wide.data.byteLength);
try {
  new ImageData(0, 1);
} catch (error: any) {
  console.log(error.name, error.code);
}
