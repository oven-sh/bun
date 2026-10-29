const bytes = new TextEncoder().encode("h\u00e9llo \u20ac");
const into = new Uint8Array(4);
console.log(
  bytes.length,
  new TextDecoder().decode(bytes),
  JSON.stringify(new TextEncoder().encodeInto("\u20acx", into)),
  new TextDecoder("utf-16le").decode(new Uint8Array([104, 0])),
  new TextDecoder("latin1").encoding,
  new TextDecoder("utf-8", { fatal: true }).fatal,
);
try {
  new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array([0xff]));
} catch (error: any) {
  console.log(error.code ?? error.name);
}
