// Reads the kinds of PNG file that Bun.Image writes, the slow way, and throws at the first rule that is not kept.
// https://www.w3.org/TR/png-3/
import { INDEXED, paeth, RGBA, signature } from "./write";

export function read(input: Uint8Array) {
  const file = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const fail = (what: string): never => {
    throw new Error(`not a valid PNG file: ${what}`);
  };
  if (!file.subarray(0, 8).equals(signature)) fail("signature");
  const chunks: { type: string; data: Buffer }[] = [];
  for (let at = 8; at < file.length;) {
    if (at + 12 > file.length) fail("half a chunk");
    const length = file.readUInt32BE(at);
    if (at + 12 + length > file.length) fail("a chunk longer than the file");
    if (Bun.hash.crc32(file.subarray(at + 4, at + 8 + length)) !== file.readUInt32BE(at + 8 + length)) fail("CRC");
    chunks.push({ type: file.toString("latin1", at + 4, at + 8), data: file.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  // One of each but IDAT, and those side by side.
  const types = chunks.map(c => c.type).filter((type, i, all) => type !== "IDAT" || all[i - 1] !== "IDAT");
  if (!/^IHDR( iCCP)?( PLTE( tRNS)?)? IDAT IEND$/.test(types.join(" "))) fail(`chunks ${types.join(" ")}`);
  const only = (type: string) => chunks.find(c => c.type === type)?.data;

  const header = only("IHDR")!;
  if (header.length !== 13 || only("IEND")!.length !== 0) fail("length of IHDR or IEND");
  const [width, height] = [header.readUInt32BE(0), header.readUInt32BE(4)];
  const [depth, colorType, compression, filterMethod, interlace] = header.subarray(8);
  if (!width || !height || depth !== 8 || compression || filterMethod || interlace) fail("IHDR");
  if (colorType !== RGBA && colorType !== INDEXED) fail(`color type ${colorType}`);
  const [palette, alphas] = [only("PLTE"), only("tRNS")];
  if ((colorType === INDEXED) !== !!palette) fail("PLTE");
  if (palette && (palette.length % 3 || palette.length < 3 || palette.length > 768)) fail("length of PLTE");
  if (alphas && (!alphas.length || alphas.length > palette!.length / 3)) fail("length of tRNS");

  let profile: Buffer | undefined;
  const iccp = only("iCCP");
  if (iccp) {
    const end = iccp.indexOf(0);
    const name = iccp.subarray(0, end);
    const printable = name.every(c => (c >= 32 && c <= 126) || c >= 161);
    if (end < 1 || end > 79 || !printable || / $|^ | {2}/.test(name.toString("latin1"))) fail("name of the profile");
    if (iccp[end + 1] !== 0) fail("compression method of the profile");
    profile = inflate(iccp.subarray(end + 2));
    if (!profile.length) fail("an empty profile");
  }

  /** The whole of it has to be one zlib stream. */
  function inflate(stream: Buffer) {
    if (
      stream.length < 6 ||
      (stream[0] & 15) !== 8 ||
      stream[0] >> 4 > 7 ||
      stream.readUInt16BE(0) % 31 ||
      stream[1] & 32
    ) {
      fail("zlib header");
    }
    // Throws unless the checksum comes right after the data. That it is also the end says that nothing follows it.
    const out = Buffer.from(Bun.inflateSync(stream, { windowBits: 15 }));
    if (stream.readUInt32BE(stream.length - 4) !== Bun.hash.adler32(out)) fail("something after the zlib stream");
    return out;
  }

  const bytesPerPixel = colorType === RGBA ? 4 : 1;
  const stride = width * bytesPerPixel;
  const lines = inflate(Buffer.concat(chunks.filter(c => c.type === "IDAT").map(c => c.data)));
  if (lines.length !== height * (1 + stride)) fail(`${lines.length} bytes of rows`);
  const pixels = Buffer.alloc(height * stride);
  const filters: number[] = [];
  for (let y = 0; y < height; y++) {
    const filter = lines[y * (1 + stride)];
    if (filter > 4) fail(`filter type ${filter}`);
    filters.push(filter);
    const [from, to] = [y * (1 + stride) + 1, y * stride];
    for (let i = 0; i < stride; i++) {
      const a = i < bytesPerPixel ? 0 : pixels[to + i - bytesPerPixel];
      const b = y ? pixels[to + i - stride] : 0;
      let predicted = 0;
      if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = (a + b) >> 1;
      else if (filter === 4)
        predicted = paeth(a, b, y && i >= bytesPerPixel ? pixels[to + i - stride - bytesPerPixel] : 0);
      pixels[to + i] = lines[from + i] + predicted;
    }
  }
  let rgba = pixels;
  if (palette) {
    rgba = Buffer.alloc(width * height * 4);
    for (const [i, index] of pixels.entries()) {
      if (index * 3 >= palette.length) fail(`index ${index} into ${palette.length / 3} colors`);
      rgba.set(palette.subarray(index * 3, index * 3 + 3), i * 4);
      rgba[i * 4 + 3] = alphas?.[index] ?? 255;
    }
  }
  return { width, height, colorType, rgba, profile, filters, colors: palette ? palette.length / 3 : undefined, chunks };
}
