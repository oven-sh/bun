/** scripts/build/icu-repack.ts: what it keeps of ICU's data package, and that it writes the package as ICU lays it out. */
import { describe, expect, test } from "bun:test";

import {
  assertRbnfKeepList,
  isLoaded,
  keepRawPatterns,
  readPackage,
  writePackage,
} from "../../scripts/build/icu-repack.ts";
import { itemsOf } from "../../scripts/build/trim/icu-data.ts";
import { packageOf } from "./icu-data-package.ts";

describe("the package", () => {
  const raw = packageOf([
    ["icudt79l/brkitr/root.res", 33],
    ["icudt79l/de.res", 16],
    ["icudt79l/zoneinfo64.res", 5],
  ]);

  test("read and written again is the same bytes", () => {
    const pkg = readPackage(raw);
    expect(pkg.prefix).toBe("icudt79l");
    expect(pkg.items.map(({ name }) => name)).toEqual(["brkitr/root.res", "de.res", "zoneinfo64.res"]);
    expect(writePackage(pkg, pkg.items).equals(raw)).toBe(true);
  });

  test("written with other items is one the reader of the trimmable link takes", () => {
    const pkg = readPackage(raw);
    const written = writePackage(pkg, [pkg.items[0]!, { name: "de.res", body: Buffer.from("frame") }]);
    // An item's size reaches to the next one, which starts at a multiple of 16.
    expect(itemsOf(written)).toEqual([
      { name: "brkitr/root.res", size: 48 },
      { name: "de.res", size: 5 },
    ]);
    expect(readPackage(written).items[1]!.body.toString()).toBe("frame");
  });

  test("of another kind is refused", () => {
    expect(() => readPackage(Buffer.alloc(64))).toThrow("ICU's data package is malformed");
    expect(() => readPackage(packageOf([["other/de.res", 16]]))).toThrow(
      "The names of ICU's data start with 'other', not icudt<NN>l",
    );
  });
});

test("what bun never loads is left out, but for the number formats ICU reaches by itself", () => {
  const items = [
    ...["de.res", "coll/de.res", "nfc.nrm", "rbnf/root.res", "rbnf/zh_Hant.res"],
    ...["ibm-37_P100-1995.cnv", "cnvalias.icu", "rfc3491.spp", "confusables.cfu", "translit/el.res", "unames.icu"],
    "rbnf/de.res",
  ];
  expect(items.filter(isLoaded)).toEqual(["de.res", "coll/de.res", "nfc.nrm", "rbnf/root.res", "rbnf/zh_Hant.res"]);
});

test("a numbering system whose rules are left out fails the build", () => {
  const numberingSystems = (...rules: string[]) => [
    { name: "numberingSystems.res", body: Buffer.from(rules.join("\0"), "utf16le") },
  ];
  expect(() => assertRbnfKeepList(numberingSystems("zh_Hant/SpelloutRules/%spellout-cardinal", "latn"))).not.toThrow();
  expect(() => assertRbnfKeepList(numberingSystems("ko/SpelloutRules/%spellout-cardinal"))).toThrow(
    "numberingSystems.res also reaches the rbnf rules of ko",
  );
  expect(() => assertRbnfKeepList([])).toThrow("the package has no numberingSystems.res");
});

test("a * of keep-raw.txt stays within one path segment", () => {
  const patterns = keepRawPatterns("# comment\n\nnfc.nrm  # why\nbrkitr/*.brk\n*.icu\n");
  const raw = (name: string) => patterns.some(pattern => pattern.test(name));
  expect(["nfc.nrm", "brkitr/word.brk", "uprops.icu"].map(raw)).toEqual([true, true, true]);
  expect(["nfcXnrm", "brkitr/a/word.brk", "coll/ucadata.icu", "xnfc.nrm"].map(raw)).toEqual([
    false,
    false,
    false,
    false,
  ]);
});
