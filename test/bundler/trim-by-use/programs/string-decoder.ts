import { StringDecoder } from "node:string_decoder";
const decoder = new StringDecoder("utf8");
console.log(
  decoder.write(Buffer.from([0xe2, 0x82])) + decoder.write(Buffer.from([0xac])) + decoder.end(),
  (decoder as any).encoding,
  new StringDecoder("hex").write(Buffer.from([1, 255])),
);
