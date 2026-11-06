console.log(
  new Uint8Array([104, 105]).toBase64(),
  Uint8Array.fromBase64("aGk=").length,
  encodeURIComponent("a b"),
  escape("a b"),
  unescape("a%20b"),
);
