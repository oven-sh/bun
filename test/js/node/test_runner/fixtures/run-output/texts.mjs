// Lines that are, or once were, the form of a test result on the stdout of a test file.
const neverRan = { name: "never ran", nesting: 0 };
// A line with this marker and JSON after it was a result before Bun framed results in bytes.
const marker = (type, data) => "\0bun:test:run\0" + JSON.stringify({ type, data });
// The frame Bun reads: 0xFF, a tag, the length of the payload, the payload, 0xFE.
const payload = Buffer.from(JSON.stringify({ type: "test:pass", data: neverRan }));
const length = Buffer.alloc(4);
length.writeUInt32BE(payload.length);
const frame = Buffer.concat([Buffer.of(0xff), Buffer.from("bun:test:run"), length, payload, Buffer.of(0xfe)]);

export const printed = [
  marker("test:pass", neverRan),
  marker("test:fail", { ...neverRan, error: { message: "made up" } }),
  marker("test:fail", { ...neverRan, error: null }),
  marker("test:fail", { ...neverRan, error: { message: "made up", cause: null } }),
  marker("end", {}),
  marker("close", {}),
  marker("error", {}),
  marker("data", {}),
  "mid-line " + marker("test:pass", neverRan),
  // A text write encodes the lead and end bytes of a frame as two bytes each.
  frame.toString("latin1"),
  // The frame after a text decoder, as a test prints it when it logs what a nested run wrote.
  new TextDecoder().decode(frame),
];
