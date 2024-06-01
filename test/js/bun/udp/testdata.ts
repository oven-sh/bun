export const nodeDataTypes = [
  {
    binaryType: "buffer",
    type: Buffer,
  },
  {
    binaryType: "uint8array",
    type: Uint8Array,
  },
];

export const dataTypes = [
  ...nodeDataTypes,
  {
    binaryType: undefined,
    type: Buffer,
  },
  {
    binaryType: "arraybuffer",
    type: ArrayBuffer,
  },
];

export const nodeDataCases = [
  {
    label: "string (ascii)",
    data: "ascii",
    bytes: Buffer.from([0x61, 0x73, 0x63, 0x69, 0x69]),
  },
  {
    label: "string (latin1)",
    data: "latin1-©",
    bytes: Buffer.from([0x6c, 0x61, 0x74, 0x69, 0x6e, 0x31, 0x2d, 0xc2, 0xa9]),
  },
  {
    label: "string (utf-8)",
    data: "utf8-😶",
    bytes: Buffer.from([0x75, 0x74, 0x66, 0x38, 0x2d, 0xf0, 0x9f, 0x98, 0xb6]),
  },
  {
    label: "string (empty)",
    data: "",
    bytes: Buffer.from([]),
  },
  {
    label: "Uint8Array (utf-8)",
    data: new TextEncoder().encode("utf8-🙂"),
    bytes: Buffer.from([0x75, 0x74, 0x66, 0x38, 0x2d, 0xf0, 0x9f, 0x99, 0x82]),
  },
  {
    label: "Uint8Array (empty)",
    data: new Uint8Array(),
    bytes: Buffer.from([]),
  },
  {
    label: "Buffer (utf-8)",
    data: Buffer.from("utf8-🤩"),
    bytes: Buffer.from([0x75, 0x74, 0x66, 0x38, 0x2d, 0xf0, 0x9f, 0xa4, 0xa9]),
  },
  {
    label: "Buffer (empty)",
    data: Buffer.from([]),
    bytes: Buffer.from([]),
  },
];

export const dataCases = [
  ...nodeDataCases,
  {
    label: "ArrayBuffer (utf-8)",
    data: new TextEncoder().encode("utf8-🙃").buffer,
    bytes: Buffer.from([0x75, 0x74, 0x66, 0x38, 0x2d, 0xf0, 0x9f, 0x99, 0x83]),
  },
  {
    label: "ArrayBuffer (empty)",
    data: new ArrayBuffer(0),
    bytes: Buffer.from([]),
  },
];
