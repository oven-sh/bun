//#FILE: test-whatwg-encoding-custom-fatal-streaming.js
//#SHA1: 325f0a1e055a1756532d2818d4e563dfbddb928b
//-----------------
"use strict";

// From: https://github.com/w3c/web-platform-tests/blob/d74324b53c/encoding/textdecoder-fatal-streaming.html
// With the twist that we specifically test for Node.js error codes

if (!globalThis.Intl) {
  test.skip("missing Intl", () => {});
} else {
  test("TextDecoder with fatal option and invalid sequences", () => {
    [
      { encoding: "utf-8", sequence: [0xc0] },
      { encoding: "utf-16le", sequence: [0x00] },
      { encoding: "utf-16be", sequence: [0x00] },
    ].forEach(testCase => {
      const data = new Uint8Array(testCase.sequence);
      expect(() => {
        const decoder = new TextDecoder(testCase.encoding, { fatal: true });
        decoder.decode(data);
      }).toThrow(
        expect.objectContaining({
          code: "ERR_ENCODING_INVALID_ENCODED_DATA",
          name: "TypeError",
          message: expect.any(String),
        }),
      );
    });
  });

  test("TextDecoder with utf-16le and streaming", () => {
    const decoder = new TextDecoder("utf-16le", { fatal: true });
    const odd = new Uint8Array([0x00]);
    const even = new Uint8Array([0x00, 0x00]);

    expect(() => {
      decoder.decode(even, { stream: true });
      decoder.decode(odd);
    }).toThrow(
      expect.objectContaining({
        code: "ERR_ENCODING_INVALID_ENCODED_DATA",
        name: "TypeError",
        message: expect.any(String),
      }),
    );

    expect(() => {
      decoder.decode(odd, { stream: true });
      decoder.decode(even);
    }).toThrow(
      expect.objectContaining({
        code: "ERR_ENCODING_INVALID_ENCODED_DATA",
        name: "TypeError",
        message: expect.any(String),
      }),
    );
  });
}

//<#END_FILE: test-whatwg-encoding-custom-fatal-streaming.js
