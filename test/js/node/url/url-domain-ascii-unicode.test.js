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
  // Node stringifies the argument, so these parse as the domains "null"/"undefined".
  [null, "null"],
  [undefined, "undefined"],
  ["2001:0db8:85a3:0000:0000:8a2e:0370:7334", ""],
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

// hasValidPunycodeHost still rejects these hosts, so domainToUnicode returns "" where Node v26.10.0 returns the value
// in the tables below. The list goes away with that check (whatwg/url#914).
const knownRejectDeviations = new Set([
  "xn--xn--zca-hia.xn--mgbh0fb",
  "xn--nxa.xn--",
  "xn--nxa.xn--abc-",
  "xn--nxa-",
  "xn--1ug.xn--nxa",
  "xn--nxa.xn--1ug",
  "xn--a.b",
  "xn--nxa.xn--abc.xn--nxa",
  "xn--nxa.xn--fffd.xn--nxa",
  "xn--nxa.xn--%41.xn--nxa",
  "xn--nxa_.xn--nxa",
]);

// Node keeps a label that fails UTS #46 as it is (ada::idna::to_unicode). ICU appends U+FFFD to it. Values are from
// Node v26.10.0. The ASCII fast path of hasValidPunycodeHost lacks the rule these labels break, so they get here.
describe("url.domainToUnicode with an xn-- label that fails UTS #46", () => {
  test.each([
    // The label decodes to "xn--zca£". UTS #46 4.1 criterion 4: a decoded label must not begin with "xn--".
    ["xn--xn--zca-hia", "xn--xn--zca-hia"],
    ["xn--xn---epa", "xn--xn---epa"],
    ["XN--XN--ZCA-HIA.Example", "xn--xn--zca-hia.example"],
    // The valid labels still decode.
    ["a.xn--xn--ab-gva.b", "a.xn--xn--ab-gva.b"],
    ["xn--zca.xn--xn--zca-hia", "ß.xn--xn--zca-hia"],
    ["xn--xn--zca-hia.xn--maana-pta.xn--ls8h", "xn--xn--zca-hia.mañana.💩"],
    ["xn--xn--zca-hia.xn--mgbh0fb", "xn--xn--zca-hia.مثال"],
  ])("%s", (input, expected) => {
    expect(url.domainToUnicode(input)).toBe(knownRejectDeviations.has(input) ? "" : expected);
  });
});

describe("url.domainToUnicode with many xn-- labels", () => {
  // The whole-name ICU conversion moves the rest of the name for each decoded label. That takes more than 9 s for
  // this host on a debug build, so the test times out. One conversion per label takes 0.2 s.
  // Node (ada 4.0.0) returns "" for a host of more than 16384 bytes. Bun has no cap.
  test("takes linear time in the number of xn-- labels", () => {
    const labels = 131072;
    const host = Buffer.alloc(labels * 8, "xn--nxa.").toString() + "com";
    expect(url.domainToUnicode(host)).toBe(Buffer.alloc(labels * 3, "β.").toString() + "com");
  });

  // Expected values are from Node v26.10.0.
  test.each([
    ["xn--nxa.xn--nxa.xn--nxa.com", "β.β.β.com"],
    ["xn--nxa..xn--nxa", "β..β"],
    ["xn--nxa.", "β."],
    [".xn--nxa", ".β"],
    ["xn--nxa.xn--", "β.xn--"],
    ["xn--nxa.xn--abc-", "β.xn--abc-"],
    ["xn--nxa-", "xn--nxa-"],
    ["xn--nxa.ab--cd", "β.ab--cd"],
    ["xn--nxa.-ab.ab-", "β.-ab.ab-"],
    ["XN--NXA.Com", "β.com"],
    ["xn--zca.xn--zca", "ß.ß"],
    ["xn--mgbh0fb.xn--nxa", "مثال.β"],
    ["xn--4dbklr2c8d.xn--4dbrk0ce.museum", "איקו״ם.ישראל.museum"],
    ["xn--mgba3a4fra.xn--fiqs8s.xn--h2brj9c", "ايران.中国.भारत"],
    ["xn--ls8h.xn--nxa", "💩.β"],
    ["xn--1ug.xn--nxa", "xn--1ug.β"],
    ["xn--nxa.xn--1ug", "β.xn--1ug"],
    ["xn--9ca.xn--nxa", "é.β"],
    ["xn--n3h.xn--nxa", "☃.β"],
    ["xn--a.b", "xn--a.b"],
    [
      "xn--nxa." + "xn--80aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "β." + Buffer.alloc(120, "а").toString(),
    ],
    ["xn--nxa.xn--nxa.1.2.3.4", ""],
    ["xn--nxa.0x7f.1", ""],
    ["[::1]", "[::1]"],
    ["ß.β.xn--nxa", "ß.β.β"],
    ["xn--nxa.xn--abc.xn--nxa", "β.xn--abc.β"],
    ["xn--nxa.xn--fffd.xn--nxa", "β.xn--fffd.β"],
    ["xn--nxa.xn--\u0000.xn--nxa", ""],
    ["xn--nxa.xn--%41.xn--nxa", "β.xn--a.β"],
    ["xn--nxa_.xn--nxa", "xn--nxa_.β"],
    ["xn--nxa.xn--nxa/path", "β.β"],
    ["xn--nxa.xn--nxa?query", "β.β"],
  ])("matches Node: %j", (input, expected) => {
    expect(url.domainToUnicode(input)).toBe(knownRejectDeviations.has(input) ? "" : expected);
  });
});
