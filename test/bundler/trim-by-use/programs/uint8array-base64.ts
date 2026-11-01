const bytes: any = new Uint8Array([72, 101, 108, 108, 111, 255]);
const type: any = Uint8Array;
console.log(
  bytes.toBase64(),
  bytes.toBase64({ alphabet: "base64url", omitPadding: true }),
  bytes.toHex(),
  type.fromBase64("SGVsbG8=").join(),
  type.fromHex("48656c6c6f").join(),
);
const into: any = new Uint8Array(4);
console.log(
  JSON.stringify(into.setFromBase64("SGVsbG8=")),
  into.join(),
  JSON.stringify(into.setFromHex("0102")),
  into.join(),
  (Buffer.from("hi") as any).toBase64(),
);
try {
  type.fromHex("zz");
} catch (error) {
  console.log((error as Error).name);
}
