const decoder = new TextDecoder();
console.log(
  decoder.decode(new Uint8Array([0xe2, 0x82]), { stream: true }) + decoder.decode(new Uint8Array([0xac])),
  Buffer.from([0xe2, 0x82, 0xac]).toString("utf8"),
);
