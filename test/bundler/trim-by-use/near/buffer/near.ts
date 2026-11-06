const bytes = new TextEncoder().encode("hello \u20ac");
console.log(
  bytes.length,
  bytes.constructor.name,
  new TextDecoder().decode(bytes),
  bytes.toHex(),
  bytes.toBase64(),
  Uint8Array.fromBase64("aGk=").length,
  bytes.indexOf(108),
  bytes.subarray(1, 3).length,
);
console.log(
  bytes,
  (await new Blob([bytes]).bytes()).length,
  (await new Response(bytes).arrayBuffer()).byteLength,
  atob(btoa("hi")),
);
const sink = new Bun.ArrayBufferSink();
sink.start({ asUint8Array: true });
sink.write("abc");
console.log((sink.end() as Uint8Array).length);
