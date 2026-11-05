const buffer = Buffer.from("hello \u20ac", "utf8");
console.log(
  buffer.length,
  buffer.toString("hex"),
  buffer.toString("base64"),
  buffer.readUInt16BE(0),
  buffer.indexOf("l"),
  buffer.lastIndexOf("l"),
  Buffer.concat([buffer, Buffer.alloc(2, 1)]).length,
  Buffer.isBuffer(buffer),
  buffer.subarray(1, 3).toString("latin1"),
  Buffer.byteLength("\u20ac"),
  buffer.equals(Buffer.from(buffer)),
  Buffer.compare(Buffer.from("a"), Buffer.from("b")),
);
const numbers = Buffer.alloc(16);
numbers.writeDoubleLE(1.5, 0);
numbers.writeInt32BE(-7, 8);
numbers.swap32();
console.log(
  numbers.toString("hex"),
  JSON.stringify(Buffer.from([1, 2])),
  Buffer.from("aGk", "base64url").toString(),
  Buffer.from("00ff", "hex")[1],
);
console.log(buffer);
