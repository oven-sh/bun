const lines: string[] = [];
const hex = (bytes: Uint8Array | ArrayBuffer) => Buffer.from(bytes as Uint8Array).toString("hex");
const say = (name: string, value: unknown) =>
  lines.push(`${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`);

const ascii = "The quick brown fox jumps over the lazy dog. ".repeat(9);
const latin1 = "Zwölf Boxkämpfer jagen Viktor quer über den großen Sylter Deich. ".repeat(7);
const wide = "Ελληνικά, кириллица, 日本語, 한국어, עברית ".repeat(8);
const astral = "a😀b𝒳c🏳️‍🌈d ".repeat(12);
const lone = "ok\ud800mid\udc00end" + "x".repeat(70) + "\udfff";
const texts = { ascii, latin1, wide, astral, lone };

const sum = (text: string) => Bun.hash.crc32(text).toString(16);
for (const [name, text] of Object.entries(texts)) {
  const utf8 = new TextEncoder().encode(text);
  say(`${name} to UTF-8`, [utf8.length, Buffer.byteLength(text), sum(hex(utf8))]);
  say(`${name} and back`, new TextDecoder().decode(utf8) === text.toWellFormed());
  say(`${name} into a small buffer`, new TextEncoder().encodeInto(text, new Uint8Array(37)));
  for (const encoding of [
    "utf8",
    "utf16le",
    "ucs2",
    "latin1",
    "binary",
    "ascii",
    "base64",
    "base64url",
    "hex",
  ] as const) {
    const bytes = Buffer.from(text, encoding);
    say(`${name} as ${encoding}`, [
      bytes.length,
      Buffer.byteLength(text, encoding),
      sum(hex(bytes)),
      sum(bytes.toString(encoding)),
    ]);
  }
  say(`${name} is well formed`, [text.isWellFormed(), sum(text.toWellFormed())]);
  say(`${name} UTF-16 decoded`, sum(new TextDecoder("utf-16le").decode(Buffer.from(text, "utf16le"))));
  say(`${name} through a Blob`, sum(await new Blob([text]).text()));
  say(`${name} through a Response`, sum(await new Response(text).text()));
}

const broken = [
  [0xc3, 0x28],
  [0xe2, 0x82],
  [0xf0, 0x9f, 0x98],
  [0xed, 0xa0, 0x80],
  [0xf8, 0x88, 0x80, 0x80, 0x80],
  [...Buffer.from(ascii), 0xff, ...Buffer.from(wide)],
];
for (const bytes of broken) {
  const view = Uint8Array.from(bytes);
  say("broken UTF-8, replaced", sum(new TextDecoder().decode(view)));
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(view);
    say("broken UTF-8, fatal", "accepted");
  } catch (error) {
    say("broken UTF-8, fatal", (error as Error).name);
  }
  say("broken UTF-8, Buffer", sum(Buffer.from(view).toString("utf8")));
  say("isUtf8, isAscii", [require("node:buffer").isUtf8(view), require("node:buffer").isAscii(view)]);
}

const bytes = Uint8Array.from({ length: 1000 }, (_, at) => (at * 37 + 11) & 255);
const base64 = Buffer.from(bytes).toString("base64");
say("base64", [
  base64.length,
  sum(base64),
  sum(Buffer.from(bytes).toString("base64url")),
  sum(btoa(latin1.slice(0, 200))),
]);
say("base64 back", [
  hex(Buffer.from(base64, "base64")) === hex(bytes),
  sum(atob(base64)),
  sum(hex(Buffer.from(base64.replace(/=+$/, "") + "\n ", "base64"))),
]);
say("base64 of a wide string", hex(Buffer.from(base64.slice(0, 40) + "é日", "base64")));
for (const text of ["", "Zg", "Zg=", "Zg==", "Zm9", "Zm9v", "Z g 9 v", "Zm9v!", "@@@@", "Zm9vYg==Zm8="]) {
  try {
    say(`atob ${JSON.stringify(text)}`, atob(text));
  } catch (error) {
    say(`atob ${JSON.stringify(text)}`, (error as Error).name);
  }
  say(`Buffer ${JSON.stringify(text)}`, hex(Buffer.from(text, "base64")));
}
const typed = Uint8Array as unknown as { fromBase64?: (text: string, options?: object) => Uint8Array };
if (typed.fromBase64) {
  say("Uint8Array.fromBase64", hex(typed.fromBase64(base64)) === hex(bytes));
  say("Uint8Array.fromBase64, base64url", hex(typed.fromBase64("_-8", { alphabet: "base64url" })));
  say("toBase64", sum((bytes as unknown as { toBase64(): string }).toBase64()));
}
say("the width of a string", [Bun.stringWidth(ascii), Bun.stringWidth(wide), Bun.stringWidth(astral)]);

console.log(lines.join("\n"));
