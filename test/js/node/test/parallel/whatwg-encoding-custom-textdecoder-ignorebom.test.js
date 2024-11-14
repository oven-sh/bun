//#FILE: test-whatwg-encoding-custom-textdecoder-ignorebom.js
//#SHA1: 8a119026559b0341b524a97eaaf87e948a502dd6
//-----------------
"use strict";

// From: https://github.com/w3c/web-platform-tests/blob/7f567fa29c/encoding/textdecoder-ignorebom.html
// This is the part that can be run without ICU

const cases = [
  {
    encoding: "utf-8",
    bytes: [0xef, 0xbb, 0xbf, 0x61, 0x62, 0x63],
  },
  {
    encoding: "utf-16le",
    bytes: [0xff, 0xfe, 0x61, 0x00, 0x62, 0x00, 0x63, 0x00],
  },
];

cases.forEach(testCase => {
  test(`TextDecoder with ${testCase.encoding} encoding`, () => {
    const BOM = "\uFEFF";
    let decoder = new TextDecoder(testCase.encoding, { ignoreBOM: true });
    const bytes = new Uint8Array(testCase.bytes);
    expect(decoder.decode(bytes)).toBe(`${BOM}abc`);

    decoder = new TextDecoder(testCase.encoding, { ignoreBOM: false });
    expect(decoder.decode(bytes)).toBe("abc");

    decoder = new TextDecoder(testCase.encoding);
    expect(decoder.decode(bytes)).toBe("abc");
  });
});

//<#END_FILE: test-whatwg-encoding-custom-textdecoder-ignorebom.js
