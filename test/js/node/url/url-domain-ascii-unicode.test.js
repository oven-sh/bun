import { describe, expect, test } from "bun:test";
import url from "node:url";

const pairs = [
  ["ıíd", "xn--d-iga7r"],
  ["يٴ", "xn--mhb8f"],
  ["www.ϧƽəʐ.com", "www.xn--cja62apfr6c.com"],
  ["новини.com", "xn--b1amarcd.com"],
  ["名がドメイン.com", "xn--v8jxj3d1dzdz08w.com"],
  ["افغانستا.icom.museum", "xn--mgbaal8b0b9b2b.icom.museum"],
  ["الجزائر.icom.fake", "xn--lgbbat1ad8j.icom.fake"],
  ["भारत.org", "xn--h2brj9c.org"],
  ["افغانستا.icom.museum", "xn--mgbaal8b0b9b2b.icom.museum"],
  ["الجزائر.icom.museum", "xn--lgbbat1ad8j.icom.museum"],
  ["österreich.icom.museum", "xn--sterreich-z7a.icom.museum"],
  ["বাংলাদেশ.icom.museum", "xn--54b6eqazv8bc7e.icom.museum"],
  ["беларусь.icom.museum", "xn--80abmy0agn7e.icom.museum"],
  ["belgië.icom.museum", "xn--belgi-rsa.icom.museum"],
  ["българия.icom.museum", "xn--80abgvm6a7d2b.icom.museum"],
  ["تشادر.icom.museum", "xn--mgbfqim.icom.museum"],
  ["中国.icom.museum", "xn--fiqs8s.icom.museum"],
  ["القمر.icom.museum", "xn--mgbu4chg.icom.museum"],
  ["κυπρος.icom.museum", "xn--vxakcego.icom.museum"],
  ["českárepublika.icom.museum", "xn--eskrepublika-ebb62d.icom.museum"],
  ["مصر.icom.museum", "xn--wgbh1c.icom.museum"],
  ["ελλάδα.icom.museum", "xn--hxakic4aa.icom.museum"],
  ["magyarország.icom.museum", "xn--magyarorszg-t7a.icom.museum"],
  ["ísland.icom.museum", "xn--sland-ysa.icom.museum"],
  ["भारत.icom.museum", "xn--h2brj9c.icom.museum"],
  ["ايران.icom.museum", "xn--mgba3a4fra.icom.museum"],
  ["éire.icom.museum", "xn--ire-9la.icom.museum"],
  ["איקו״ם.ישראל.museum", "xn--4dbklr2c8d.xn--4dbrk0ce.museum"],
  ["日本.icom.museum", "xn--wgv71a.icom.museum"],
  ["الأردن.icom.museum", "xn--igbhzh7gpa.icom.museum"],
  ["қазақстан.icom.museum", "xn--80aaa0a6awh12ed.icom.museum"],
  ["한국.icom.museum", "xn--3e0b707e.icom.museum"],
  ["кыргызстан.icom.museum", "xn--80afmksoji0fc.icom.museum"],
  ["ລາວ.icom.museum", "xn--q7ce6a.icom.museum"],
  ["لبنان.icom.museum", "xn--mgbb7fjb.icom.museum"],
  ["македонија.icom.museum", "xn--80aaldqjmmi6x.icom.museum"],
  ["موريتانيا.icom.museum", "xn--mgbah1a3hjkrd.icom.museum"],
  ["méxico.icom.museum", "xn--mxico-bsa.icom.museum"],
  ["монголулс.icom.museum", "xn--c1aqabffc0aq.icom.museum"],
  ["المغرب.icom.museum", "xn--mgbc0a9azcg.icom.museum"],
  ["नेपाल.icom.museum", "xn--l2bey1c2b.icom.museum"],
  ["عمان.icom.museum", "xn--mgb9awbf.icom.museum"],
  ["قطر.icom.museum", "xn--wgbl6a.icom.museum"],
  ["românia.icom.museum", "xn--romnia-yta.icom.museum"],
  ["россия.иком.museum", "xn--h1alffa9f.xn--h1aegh.museum"],
  ["србијаицрнагора.иком.museum", "xn--80aaabm1ab4blmeec9e7n.xn--h1aegh.museum"],
  ["இலங்கை.icom.museum", "xn--xkc2al3hye2a.icom.museum"],
  ["españa.icom.museum", "xn--espaa-rta.icom.museum"],
  ["ไทย.icom.museum", "xn--o3cw4h.icom.museum"],
  ["تونس.icom.museum", "xn--pgbs0dh.icom.museum"],
  ["türkiye.icom.museum", "xn--trkiye-3ya.icom.museum"],
  ["украина.icom.museum", "xn--80aaxgrpt.icom.museum"],
  ["việtnam.icom.museum", "xn--vitnam-jk8b.icom.museum"],
  [`${"a".repeat(64)}.com`, `${"a".repeat(64)}.com`],
  [`${`${"a".repeat(64)}.`.repeat(4)}com`, `${`${"a".repeat(64)}.`.repeat(4)}com`],
  ["r4---sn-a5mlrn7s.gevideo.com", "r4---sn-a5mlrn7s.gevideo.com"],
  ["-sn-a5mlrn7s.gevideo.com", "-sn-a5mlrn7s.gevideo.com"],
  ["sn-a5mlrn7s-.gevideo.com", "sn-a5mlrn7s-.gevideo.com"],
  ["-sn-a5mlrn7s-.gevideo.com", "-sn-a5mlrn7s-.gevideo.com"],
  ["-sn--a5mlrn7s-.gevideo.com", "-sn--a5mlrn7s-.gevideo.com"],
];

const invalids = [
  ["@", ""],
  ["a@b", ""],
  [null, null],
  [undefined, undefined],
  ["2001:0db8:85a3:0000:0000:8a2e:0370:7334", ""],
];

// node defines both functions in terms of the WHATWG host parser: set the
// input as the hostname of "ws://x" and return "" on failure. Expected values
// below are [input, domainToASCII(input), domainToUnicode(input)] as produced
// by node v26.3.0.
const hostParserParity = [
  // Invalid Punycode in an all-ASCII xn-- label must fail, not echo the input.
  ["xn--a-ecp.example", "", ""],
  ["xn--a-ecp.ss", "", ""],
  ["xn--a", "", ""],
  ["xn--a.example", "", ""],
  ["xn--a.xn--nxa", "", ""],
  ["xn--zn7c.com", "", ""],
  ["xn--", "", ""],
  ["xn--.example", "", ""],
  ["a.xn--", "", ""],
  ["xn--1ug.example", "", ""],
  // Forbidden domain code points: %, C0 controls, DEL, space.
  ["a%b", "", ""],
  ["%", "", ""],
  ["%ZZ", "", ""],
  ["a\x01b", "", ""],
  ["a\x0cb", "", ""],
  ["a\x7fb", "", ""],
  ["a b", "", ""],
  [" a ", "", ""],
  // Percent-decoding happens before IDNA.
  ["%41", "a", "a"],
  ["ex%61mple.com", "example.com", "example.com"],
  ["%e4%bd%a0%e5%a5%bd", "xn--6qq79v", "\u4f60\u597d"],
  ["%zz%66%a", "", ""],
  // ASCII lowercasing.
  ["EXAMPLE.COM", "example.com", "example.com"],
  ["XN--BCHER-KVA.DE", "xn--bcher-kva.de", "b\u00fccher.de"],
  // IPv4 canonicalization and rejection.
  ["0x7f.1", "127.0.0.1", "127.0.0.1"],
  ["0x7f.0x0.0x0.0x1", "127.0.0.1", "127.0.0.1"],
  ["192.168.1.1", "192.168.1.1", "192.168.1.1"],
  ["999.999.999.999", "", ""],
  ["1.2.3.4.5", "", ""],
  ["09.1", "", ""],
  // IPv6.
  ["[::1]", "[::1]", "[::1]"],
  ["[0:0:0:0:0:0:0:1]", "[::1]", "[::1]"],
  ["[::ffff:127.0.0.1]", "[::ffff:7f00:1]", "[::ffff:7f00:1]"],
  ["[", "", ""],
  ["[:", "", ""],
  // Tab/newline stripping, truncation, and authority characters.
  ["ex\tample.com", "example.com", "example.com"],
  ["a\r\nb", "ab", "ab"],
  ["a/b", "a", "a"],
  ["a?b", "a", "a"],
  ["a#b", "a", "a"],
  ["a\\b", "a", "a"],
  ["a:80", "", ""],
  // Valid domains are preserved.
  ["example.com", "example.com", "example.com"],
  ["b\u00fccher.de", "xn--bcher-kva.de", "b\u00fccher.de"],
  ["xn--bcher-kva.de", "xn--bcher-kva.de", "b\u00fccher.de"],
  ["\u00e7.com", "xn--7ca.com", "\u00e7.com"],
  ["xn--ls8h.example", "xn--ls8h.example", "\u{1f4a9}.example"],
  ["xn--6qqa088eba", "xn--6qqa088eba", "\u4f60\u597d\u4f60\u597d"],
  ["a..b", "a..b", "a..b"],
  [".", ".", "."],
  ["..", "..", ".."],
  ["example.com.", "example.com.", "example.com."],
  ["a_b.example", "a_b.example", "a_b.example"],
  ["a-.example", "a-.example", "a-.example"],
  ["-a.example", "-a.example", "-a.example"],
  ["ab--c.example", "ab--c.example", "ab--c.example"],
  ["r4---sn-a5mlrn7s.gevideo.com", "r4---sn-a5mlrn7s.gevideo.com", "r4---sn-a5mlrn7s.gevideo.com"],
  // IDNA mapping, deviation, and context rules.
  ["x\u200bn--a.example", "", ""],
  ["xn--te\u0161la", "", ""],
  ["\ufffd.example", "", ""],
  ["fa\u00df.de", "xn--fa-hia.de", "fa\u00df.de"],
  ["\u0130.com", "xn--i-9bb.com", "i\u0307.com"],
  ["\u03c2.com", "xn--3xa.com", "\u03c2.com"],
  ["\u0dc1\u0dca\u200d\u0dbb\u0dd3", "xn--10cl1a0b660p", "\u0dc1\u0dca\u200d\u0dbb\u0dd3"],
  ["\u30c6\u30b9\u30c8.example", "xn--zckzah.example", "\u30c6\u30b9\u30c8.example"],
  ["\u200d.example", "", ""],
  ["look\u200cout.net", "", ""],
  ["", "", ""],
];

describe("url.domainToASCII", () => {
  for (const [domain, ascii] of pairs) {
    test(`convert from '${domain}' to '${ascii}'`, () => {
      const domainConvertedToASCII = url.domainToASCII(domain);
      expect(domainConvertedToASCII).toEqual(ascii);
    });
  }
  for (const [input, expected] of invalids) {
    test(`-> '${input}' is '${expected}'`, () => {
      expect(url.domainToASCII(input)).toEqual(expected);
    });
  }
});

describe("url.domainToUnicode", () => {
  for (const [domain, ascii] of pairs) {
    test(`convert from '${ascii}' to '${domain}'`, () => {
      const asciiConvertedToUnicode = url.domainToUnicode(ascii);
      expect(asciiConvertedToUnicode).toEqual(domain);
    });
  }
  for (const [input, expected] of invalids) {
    test(`-> '${input}' is '${expected}'`, () => {
      expect(url.domainToASCII(input)).toEqual(expected);
    });
  }
});

describe("WHATWG host parser parity", () => {
  for (const [input, ascii, unicode] of hostParserParity) {
    test(`${JSON.stringify(input)}`, () => {
      expect({
        ascii: url.domainToASCII(input),
        unicode: url.domainToUnicode(input),
      }).toEqual({ ascii, unicode });
    });
  }
});
