function bitmap(width: number, height: number): Uint8Array {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const bytes = new Uint8Array(54 + rowSize * height);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x42;
  bytes[1] = 0x4d;
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, rowSize * height, true);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = 54 + y * rowSize + x * 3;
      bytes[at] = x * 16;
      bytes[at + 1] = y * 16;
      bytes[at + 2] = 200;
    }
  }
  return bytes;
}

const source = bitmap(16, 8);
const describe = async (label: string, bytes: Uint8Array) => {
  const { width, height, format } = await new Bun.Image(bytes).metadata();
  console.log(label, format, width, height, bytes.length, Bun.hash.crc32(bytes));
};

await describe("bmp", source);
const png = await new Bun.Image(source).png().bytes();
await describe("png", png);
await describe("jpeg", await new Bun.Image(png).resize(8, 4).jpeg({ quality: 80 }).bytes());
await describe("webp", await new Bun.Image(png).rotate(90).webp({ quality: 80 }).bytes());
await describe("palette", await new Bun.Image(png).png({ palette: true }).bytes());
const response = new Response(new Bun.Image(png).flip().png() as any);
console.log("body", response.headers.get("content-type"), (await response.bytes()).length);
console.log("placeholder", (await new Bun.Image(png).placeholder()).slice(0, 22));
