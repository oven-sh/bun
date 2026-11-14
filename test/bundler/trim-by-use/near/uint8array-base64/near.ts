const bytes = new Uint8Array([72, 101, 108, 108, 111, 255]);
console.log(
  Buffer.from(bytes).toString("base64"),
  Buffer.from(bytes).toString("base64url"),
  Buffer.from(bytes).toString("hex"),
  Buffer.from("SGVsbG8=", "base64").join(),
  Buffer.from("48656c6c6f", "hex").join(),
);
console.log(
  btoa("Hello"),
  atob("SGVsbG8="),
  new TextDecoder().decode(bytes.subarray(0, 5)),
  new TextEncoder().encode("Hello").join(),
  Buffer.alloc(4).write("0102", "hex"),
  bytes.length,
  Uint8Array.from([1, 2]).join(),
  Uint8Array.of(3).join(),
  String(bytes),
);
Bun.gc(true);
