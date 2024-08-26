//#FILE: test-whatwg-encoding-custom-textdecoder-fatal.js
//#SHA1: e2b44e43b78b053687ab4a8dc5de7557f6637643
//-----------------
"use strict";

// From: https://github.com/w3c/web-platform-tests/blob/39a67e2fff/encoding/textdecoder-fatal.html
// With the twist that we specifically test for Node.js error codes

if (!globalThis.Intl) {
  test.skip("missing Intl");
}

const bad = [
  { encoding: "utf-8", input: [0xff], name: "invalid code" },
  { encoding: "utf-8", input: [0xc0], name: "ends early" },
  { encoding: "utf-8", input: [0xe0], name: "ends early 2" },
  { encoding: "utf-8", input: [0xc0, 0x00], name: "invalid trail" },
  { encoding: "utf-8", input: [0xc0, 0xc0], name: "invalid trail 2" },
  { encoding: "utf-8", input: [0xe0, 0x00], name: "invalid trail 3" },
  { encoding: "utf-8", input: [0xe0, 0xc0], name: "invalid trail 4" },
  { encoding: "utf-8", input: [0xe0, 0x80, 0x00], name: "invalid trail 5" },
  { encoding: "utf-8", input: [0xe0, 0x80, 0xc0], name: "invalid trail 6" },
  { encoding: "utf-8", input: [0xfc, 0x80, 0x80, 0x80, 0x80, 0x80], name: "> 0x10FFFF" },
  { encoding: "utf-8", input: [0xfe, 0x80, 0x80, 0x80, 0x80, 0x80], name: "obsolete lead byte" },
  // Overlong encodings
  { encoding: "utf-8", input: [0xc0, 0x80], name: "overlong U+0000 - 2 bytes" },
  { encoding: "utf-8", input: [0xe0, 0x80, 0x80], name: "overlong U+0000 - 3 bytes" },
  { encoding: "utf-8", input: [0xf0, 0x80, 0x80, 0x80], name: "overlong U+0000 - 4 bytes" },
  { encoding: "utf-8", input: [0xf8, 0x80, 0x80, 0x80, 0x80], name: "overlong U+0000 - 5 bytes" },
  { encoding: "utf-8", input: [0xfc, 0x80, 0x80, 0x80, 0x80, 0x80], name: "overlong U+0000 - 6 bytes" },
  { encoding: "utf-8", input: [0xc1, 0xbf], name: "overlong U+007F - 2 bytes" },
  { encoding: "utf-8", input: [0xe0, 0x81, 0xbf], name: "overlong U+007F - 3 bytes" },
  { encoding: "utf-8", input: [0xf0, 0x80, 0x81, 0xbf], name: "overlong U+007F - 4 bytes" },
  { encoding: "utf-8", input: [0xf8, 0x80, 0x80, 0x81, 0xbf], name: "overlong U+007F - 5 bytes" },
  { encoding: "utf-8", input: [0xfc, 0x80, 0x80, 0x80, 0x81, 0xbf], name: "overlong U+007F - 6 bytes" },
  { encoding: "utf-8", input: [0xe0, 0x9f, 0xbf], name: "overlong U+07FF - 3 bytes" },
  { encoding: "utf-8", input: [0xf0, 0x80, 0x9f, 0xbf], name: "overlong U+07FF - 4 bytes" },
  { encoding: "utf-8", input: [0xf8, 0x80, 0x80, 0x9f, 0xbf], name: "overlong U+07FF - 5 bytes" },
  { encoding: "utf-8", input: [0xfc, 0x80, 0x80, 0x80, 0x9f, 0xbf], name: "overlong U+07FF - 6 bytes" },
  { encoding: "utf-8", input: [0xf0, 0x8f, 0xbf, 0xbf], name: "overlong U+FFFF - 4 bytes" },
  { encoding: "utf-8", input: [0xf8, 0x80, 0x8f, 0xbf, 0xbf], name: "overlong U+FFFF - 5 bytes" },
  { encoding: "utf-8", input: [0xfc, 0x80, 0x80, 0x8f, 0xbf, 0xbf], name: "overlong U+FFFF - 6 bytes" },
  { encoding: "utf-8", input: [0xf8, 0x84, 0x8f, 0xbf, 0xbf], name: "overlong U+10FFFF - 5 bytes" },
  { encoding: "utf-8", input: [0xfc, 0x80, 0x84, 0x8f, 0xbf, 0xbf], name: "overlong U+10FFFF - 6 bytes" },
  // UTF-16 surrogates encoded as code points in UTF-8
  { encoding: "utf-8", input: [0xed, 0xa0, 0x80], name: "lead surrogate" },
  { encoding: "utf-8", input: [0xed, 0xb0, 0x80], name: "trail surrogate" },
  { encoding: "utf-8", input: [0xed, 0xa0, 0x80, 0xed, 0xb0, 0x80], name: "surrogate pair" },
  { encoding: "utf-16le", input: [0x00], name: "truncated code unit" },
  // Mismatched UTF-16 surrogates are exercised in utf16-surrogates.html
  // FIXME: Add legacy encoding cases
];

bad.forEach(t => {
  test(`TextDecoder fatal error: ${t.name}`, () => {
    expect(() => {
      new TextDecoder(t.encoding, { fatal: true }).decode(new Uint8Array(t.input));
    }).toThrow(
      expect.objectContaining({
        code: "ERR_ENCODING_INVALID_ENCODED_DATA",
        name: "TypeError",
        message: expect.any(String),
      }),
    );
  });
});

//<#END_FILE: test-whatwg-encoding-custom-textdecoder-fatal.js
