//#FILE: test-whatwg-encoding-custom-textdecoder-streaming.js
//#SHA1: d98fc14ce0348f22b3bae160b4e1e4882ce75749
//-----------------
"use strict";

// From: https://github.com/w3c/web-platform-tests/blob/fa9436d12c/encoding/textdecoder-streaming.html
// This is the part that can be run without ICU

const string = "\x00123ABCabc\x80\xFF\u0100\u1000\uFFFD\uD800\uDC00\uDBFF\uDFFF";
const octets = {
  "utf-8": [
    0x00, 0x31, 0x32, 0x33, 0x41, 0x42, 0x43, 0x61, 0x62, 0x63, 0xc2, 0x80, 0xc3, 0xbf, 0xc4, 0x80, 0xe1, 0x80, 0x80,
    0xef, 0xbf, 0xbd, 0xf0, 0x90, 0x80, 0x80, 0xf4, 0x8f, 0xbf, 0xbf,
  ],
  "utf-16le": [
    0x00, 0x00, 0x31, 0x00, 0x32, 0x00, 0x33, 0x00, 0x41, 0x00, 0x42, 0x00, 0x43, 0x00, 0x61, 0x00, 0x62, 0x00, 0x63,
    0x00, 0x80, 0x00, 0xff, 0x00, 0x00, 0x01, 0x00, 0x10, 0xfd, 0xff, 0x00, 0xd8, 0x00, 0xdc, 0xff, 0xdb, 0xff, 0xdf,
  ],
};

Object.keys(octets).forEach(encoding => {
  describe(`TextDecoder streaming for ${encoding}`, () => {
    for (let len = 1; len <= 5; ++len) {
      it(`should correctly decode with chunk size ${len}`, () => {
        const encoded = octets[encoding];
        const decoder = new TextDecoder(encoding);
        let out = "";
        for (let i = 0; i < encoded.length; i += len) {
          const sub = [];
          for (let j = i; j < encoded.length && j < i + len; ++j) sub.push(encoded[j]);
          out += decoder.decode(new Uint8Array(sub), { stream: true });
        }
        out += decoder.decode();
        expect(out).toBe(string);
      });
    }
  });
});

//<#END_FILE: test-whatwg-encoding-custom-textdecoder-streaming.js
