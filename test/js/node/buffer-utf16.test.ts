import { describe, expect, test } from "bun:test";

test("utf16-le buffer", () => {
  const twoByteString = new Array(16)
    .fill(0)
    .map((_, i) =>
      Buffer.from(
        new Array(16)
          .fill(0)
          .map((_, j) => String.fromCharCode(i * 16 + j))
          .join(""),
        "utf-16le",
      ).toString("hex"),
    )
    .join("\n");
  expect(twoByteString.toString("hex")).toEqual(
    `00000100020003000400050006000700080009000a000b000c000d000e000f00
10001100120013001400150016001700180019001a001b001c001d001e001f00
20002100220023002400250026002700280029002a002b002c002d002e002f00
30003100320033003400350036003700380039003a003b003c003d003e003f00
40004100420043004400450046004700480049004a004b004c004d004e004f00
50005100520053005400550056005700580059005a005b005c005d005e005f00
60006100620063006400650066006700680069006a006b006c006d006e006f00
70007100720073007400750076007700780079007a007b007c007d007e007f00
80008100820083008400850086008700880089008a008b008c008d008e008f00
90009100920093009400950096009700980099009a009b009c009d009e009f00
a000a100a200a300a400a500a600a700a800a900aa00ab00ac00ad00ae00af00
b000b100b200b300b400b500b600b700b800b900ba00bb00bc00bd00be00bf00
c000c100c200c300c400c500c600c700c800c900ca00cb00cc00cd00ce00cf00
d000d100d200d300d400d500d600d700d800d900da00db00dc00dd00de00df00
e000e100e200e300e400e500e600e700e800e900ea00eb00ec00ed00ee00ef00
f000f100f200f300f400f500f600f700f800f900fa00fb00fc00fd00fe00ff00`,
  );
});

// Buffer.from(latin1String, "utf16le" | "ucs2") widens each Latin-1 byte to
// one little-endian UTF-16 code unit. A JS string stays Latin-1-backed (8-bit)
// when every code point is <= U+00FF, so these inputs exercise the byte-pair
// widening loop in Bun__encoding__constructFromLatin1.
describe("latin1 -> UTF-16 widening (Buffer.from)", () => {
  describe.each(["utf16le", "utf-16le", "ucs2", "ucs-2"] as const)("%s", encoding => {
    test("empty string produces an empty buffer", () => {
      expect(Buffer.from("", encoding)).toEqual(Buffer.alloc(0));
    });

    test("single byte widens to one little-endian code unit", () => {
      // 'A' (0x41) -> 0x41 0x00
      expect([...Buffer.from("A", encoding)]).toEqual([0x41, 0x00]);
    });

    test("high bytes (0x80-0xFF) zero-extend, not sign-extend", () => {
      // \u00ff stays 8-bit; must become ff 00, not ff ff.
      expect([...Buffer.from("\x80\xff", encoding)]).toEqual([0x80, 0x00, 0xff, 0x00]);
    });

    test("every Latin-1 byte 0x00-0xFF widens correctly", () => {
      const all = Array.from({ length: 256 }, (_, i) => String.fromCharCode(i)).join("");
      const buf = Buffer.from(all, encoding);
      expect(buf.length).toBe(512);
      const expected = Buffer.alloc(512);
      for (let i = 0; i < 256; i++) expected[i * 2] = i; // low byte = i, high byte = 0
      expect(buf).toEqual(expected);
    });

    test("long input widens every chunk (round-trips back to the source)", () => {
      // Long enough to span many byte-pairs; all code points <= 0xFF so the
      // string stays 8-bit and takes the widening path.
      const latin1 = Buffer.alloc(1000, 0xe9).toString("latin1"); // "é" * 1000
      const buf = Buffer.from(latin1, encoding);
      // Every byte-pair widens 0xe9 -> [0xe9, 0x00].
      expect(buf).toEqual(Buffer.from(Array.from({ length: 1000 }, () => [0xe9, 0x00]).flat()));
      expect(buf.toString("utf16le")).toBe(latin1);
    });
  });
});
