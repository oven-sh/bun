// The callers of the kernels in src/simd_kernels, through the public API, against models in JavaScript.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { SourceMap } from "node:module";
import { posix } from "node:path";
import { crc32, deflateRawSync, deflateSync, inflateRawSync } from "node:zlib";

const LENGTHS = [1, 2, 7, 8, 15, 16, 17, 31, 32, 33, 63, 64, 65, 100, 129, 200, 300];
const narrow = (s: string) => Buffer.from(s, "latin1").toString("latin1");
const wide = (s: string) => Buffer.from(s, "utf16le").toString("utf16le");
const spots = (n: number) =>
  [...new Set([0, 1, 15, 16, 31, 32, 63, 64, n >> 1, n - 2, n - 1])].filter(p => p >= 0 && p < n);
const plant = (n: number, at: number, what: string) => Buffer.alloc(at, "a") + what + Buffer.alloc(n - at - 1, "a");

describe("Buffer searches from an offset", () => {
  // Matches lie in front of the view and behind it.
  const view = (text: string, needle: string, encoding: "latin1" | "utf16le") => {
    const around = Buffer.from(needle + needle, encoding);
    return Buffer.concat([around, Buffer.from(text, encoding), around]).subarray(around.length, -around.length);
  };

  it.each([
    ["latin1", 1],
    ["utf16le", 2],
  ] as const)("%s", (encoding, width) => {
    const [actual, expected]: unknown[][] = [[], []];
    for (const needle of ["b", "bc", "bcdefghijklmnopqrs"]) {
      for (const n of LENGTHS) {
        for (const text of [plant(n, 0, "a"), ...spots(n).map(at => plant(n, at, needle))]) {
          const buffer = view(text, needle, encoding);
          for (const offset of spots(buffer.length - width + 1)) {
            // An odd offset counts from the unit that it is in.
            const unit = Math.floor(offset / width);
            const [first, last] = [text.indexOf(needle, unit), text.lastIndexOf(needle, unit)];
            if (offset + needle.length * width > buffer.length) continue;
            const byte = needle.length * width === 1 ? [needle.charCodeAt(0)] : [];
            for (const value of [needle, Buffer.from(needle, encoding), ...byte]) {
              actual.push(
                buffer.indexOf(value, offset, encoding),
                buffer.lastIndexOf(value, offset, encoding),
                buffer.includes(value, offset, encoding),
              );
              expected.push(first < 0 ? -1 : first * width, last < 0 ? -1 : last * width, first >= 0);
            }
          }
        }
      }
    }
    expect(actual).toEqual(expected);
  });
});

it("path.posix with one untidy part at any place", () => {
  const parts = (path: string) => {
    const out: string[] = [];
    for (const part of path.split("/")) {
      if (part === "..") out.pop();
      else if (part !== "" && part !== ".") out.push(part);
    }
    return out;
  };
  const relative = (from: string[], to: string[]) => {
    let same = 0;
    while (same < from.length && from[same] === to[same]) same++;
    return [...from.slice(same).fill(".."), ...to.slice(same)].join("/");
  };
  const [actual, expected]: string[][] = [[], []];
  for (const untidy of ["/", "//", "/./", "/../", "/.a/", "/a./../", "/.a/../", "/.../../", "/..a/", "/é/"]) {
    for (const n of LENGTHS) {
      for (const at of spots(n)) {
        const rest = plant(n, at, untidy) + "z";
        const resolved = "/" + parts(rest).join("/");
        // Flat, and still to be put together.
        for (const path of [() => narrow("/" + rest), () => "/" + rest]) {
          actual.push(
            posix.normalize(path()),
            posix.join(path()),
            posix.join("/", path(), "y"),
            posix.resolve(path()),
            posix.resolve("/x", path(), "y"),
            posix.relative(path(), "/a/z"),
            posix.relative("/a/./z", path()),
            posix.relative(path(), path() + "/y"),
          );
          expected.push(
            resolved,
            resolved,
            resolved + "/y",
            resolved,
            resolved + "/y",
            relative(parts(rest), ["a", "z"]),
            relative(["a", "z"], parts(rest)),
            "y",
          );
        }
      }
    }
  }
  expect(actual).toEqual(expected);
});

describe.each([
  ["8 bits", narrow, "é"],
  ["16 bits", wide, "─"],
])("strings of %s", (_, as, other) => {
  it("escapeHTML", () => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };
    for (const n of LENGTHS) {
      for (const what of ["<", "'" + other + "&", '<>&"'.repeat(9)]) {
        const texts = spots(n).map(at => as(plant(n, at, what)));
        expect(texts.map(Bun.escapeHTML)).toEqual(texts.map(it => it.replace(/[&<>"']/g, c => entities[c])));
      }
    }
  });

  it("stripANSI and stringWidth with two sequences at any distance", () => {
    const sequences = ["\x1b[m", "\x1b[38;2;1;2;3m", "\x1b[2K", "\x1b]8;;http://a\x07", "\x1b]8;;\x1b\\", "\x9b1m"];
    const [actual, expected]: unknown[][] = [[], []];
    for (const first of sequences) {
      for (const second of sequences) {
        for (const gap of [0, ...LENGTHS, 1100]) {
          for (const tail of ["", other, plant(100, 20, other)]) {
            const between = Buffer.alloc(gap, "m[;1").toString();
            for (const before of ["x", "\x1b[1mx\x1b[m"]) {
              const text = as(before + first + between + second + tail);
              actual.push(
                Bun.stripANSI(text),
                Bun.stringWidth(text),
                Bun.stringWidth(text, { countAnsiEscapeCodes: true }),
              );
              expected.push("x" + between + tail, 1 + gap + tail.length, text.replace(/[\x07\x1b\x9b]/g, "").length);
            }
          }
        }
      }
    }
    expect(actual).toEqual(expected);
  });

  it("XML in entities, and behind a '>' in a value", () => {
    for (const n of LENGTHS) {
      for (const at of spots(n)) {
        const [text, value] = [plant(n, at, other + "&#38;#38;"), plant(n, at, other + "&")];
        const entities =
          "<!ENTITY e '" +
          text +
          "'><!ENTITY f '<!--" +
          text +
          "--><?p " +
          text +
          '?><b c="' +
          text +
          '">' +
          text +
          "</b>'>";
        const document =
          "<!DOCTYPE r [" + entities + "]><r x='>' y='" + plant(n, at, other + "&amp;") + "' z='&e;'>&f;</r>";
        const expected = { r: { "@x": ">", "@y": value, "@z": value, b: { "@c": value, "#text": value } } };
        expect(Bun.XML.parse(as(document))).toEqual(expected);
        expect(Bun.XML.parse(Buffer.from(document))).toEqual(expected);
        expect(Bun.XML.parse(Buffer.from(document), { compact: false })).toEqual(
          Bun.XML.parse(as(document), { compact: false }),
        );
        const data = "<!DOCTYPE r [<!ENTITY e '<![CDATA[" + plant(n, at, other + "]<") + "]]>'>]><r>&e;</r>";
        for (const it of [as(data), Buffer.from(data)]) {
          expect(Bun.XML.parse(it)).toEqual({ r: plant(n, at, other + "]<") });
        }
        expect(() => Bun.XML.parse(as("<r x='>' y='" + plant(n, at, "<") + "'/>"))).toThrow();
        expect(() => Bun.XML.parse(as("<!DOCTYPE r [<!ENTITY e '<!--" + text + "'>]><r>&e;</r>"))).toThrow();
      }
    }
  });

  it("JSONC and XML across the pieces that are indexed", () => {
    for (const edge of [4096, 8192, 12288, 16384]) {
      for (let at = edge - 5; at < edge + 3; at++) {
        const value = ["x", plant(20000, at - 6, '"\\' + other), "\n", 1];
        const json = JSON.stringify(value);
        expect(Bun.JSONC.parse(as(json))).toEqual(value);
        expect(Bun.JSONC.parse(as(json.slice(0, -2) + "/* , */1]"))).toEqual(value);
        expect(Bun.JSONC.parse(as('["\\t",' + Buffer.alloc(at - 6, " ") + '// "\n"\\t"]'))).toEqual(["\t", "\t"]);
        expect(Bun.XML.parse(as("<r>" + plant(20000, at - 3, other + "&lt;") + "</r>"))).toEqual({
          r: plant(20000, at - 3, other + "<"),
        });
      }
    }
  });

  it("names in FormData", async () => {
    const names = LENGTHS.flatMap(n => spots(n).map(at => as(plant(n, at, '"' + other + '\r\n"'))));
    const form = new FormData();
    for (const name of names) form.append(name, name);
    const body = await new Response(form).text();
    const written = [...body.matchAll(/name="([^"]*)"\r\n\r\n(.*?)\r\n--/gs)].map(it => it.slice(1));
    expect(written).toEqual(names.map(it => [it.replaceAll('"', "%22").replace("\r\n", "%0D%0A"), it]));
  });
});

it("stringWidth counts symbols behind a prepended mark as it counts letters", () => {
  expect(["\u0600─\ufe0f", "\u0600、\ufe0e", "\u0d4e─\ufe0f"].map(it => Bun.stringWidth(it))).toEqual([1, 2, 2]);
  for (const [letter, ...symbols] of ["é\u2010\u2027\u2500\u25a9", "世\u3000\u3029\u3300\u33ff\u4dc0\u4dff"]) {
    const widths = (it: string) =>
      [..."\u0600\u0d4e"].flatMap(mark => [..."\ufe0e\ufe0f\u20e3"].map(last => Bun.stringWidth(mark + it + last)));
    expect(symbols.map(widths)).toEqual(symbols.map(() => widths(letter)));
  }
});

it("line breaks in templates", () => {
  const transpiler = new Bun.Transpiler();
  for (const a of ["\r", "\n", "\r\n"]) {
    for (const b of ["", "\r", "\r\n", "a", "\\`", "$", "${x}"]) {
      const raw = "\n" + b.replace(/\r\n?/, "\n");
      expect(transpiler.transformSync("x`" + a + b + "`")).toBe("x`" + raw + "`;\n");
    }
    expect(() => transpiler.transformSync("x`" + a)).toThrow("Unterminated string literal");
  }
});

it("wrapAnsi of lines that are empty or short", () => {
  for (const first of ["", "a", "─"]) {
    for (const end of ["\r", "\n", "\r\n"]) {
      const lines = [first, "", "b", "", "", "cd", ""];
      expect(Bun.wrapAnsi(lines.join(end), 80)).toBe(lines.join("\n"));
    }
  }
});

it("comments that end with the file", () => {
  const transpiler = new Bun.Transpiler();
  for (const n of [...LENGTHS, 511, 512, 513, 1000]) {
    for (const last of ["a", "*", "\n", "é"]) {
      expect(() => transpiler.transformSync("x/*" + plant(n, n - 1, last))).toThrow("to terminate multi-line comment");
      expect(transpiler.transformSync("x/*" + plant(n, n - 1, last) + "*/")).toBe("x;\n");
      expect(transpiler.transformSync("x//" + plant(n, n - 1, last))).toBe("x;\n");
    }
  }
});

it("XML that ends too early", () => {
  for (const n of LENGTHS) {
    const comment = "<r/><!--" + Buffer.alloc(n, "a");
    expect(() => Bun.XML.parse(comment + "\ud83d")).toThrow("Invalid character in XML: U+D83D");
    expect(() => Bun.XML.parse(comment + "─")).toThrow("Unterminated comment");
  }
});

it("SourceMap with numbers of 1 to 7 digits", () => {
  const digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const vlq = (value: number) => {
    let [rest, out] = [value < 0 ? 1 - 2 * value : 2 * value, ""];
    for (; rest >= 32; rest = Math.floor(rest / 32)) out += digits[32 + (rest % 32)];
    return out + digits[rest];
  };
  const names = Array.from({ length: 20000 }, (_, i) => "n" + i);
  const sizes = [0, 15, 16, 511, 512, 16384, 524288, 2 ** 24, 2 ** 29];
  const rows = sizes.flatMap(line => sizes.flatMap(column => [3, 40, 600, 19999, 0].map(name => [line, column, name])));
  const mappings = rows.map((row, i) => "CA" + row.map((it, k) => vlq(it - (rows[i - 1]?.[k] ?? 0))).join(""));
  const map = new SourceMap({ version: 3, sources: ["a"], names, mappings: mappings.join(",") } as any);
  const found = rows.map((_, i) => map.findEntry(0, i + 1) as any);
  expect(found.map(it => [it.originalLine, it.originalColumn, it.name])).toEqual(
    rows.map(([line, column, name]) => [line, column, names[name]]),
  );
});

function grayImage(width: number, height: number, gray: (x: number, y: number) => number) {
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.concat([Buffer.alloc(4), Buffer.from(type), data, Buffer.alloc(4)]);
    out.writeUInt32BE(data.length);
    out.writeUInt32BE(crc32(out.subarray(4, -4)), out.length - 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  const rows = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rows[y * (width + 1) + 1 + x] = gray(x, y);
  }
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  return new Bun.Image(
    Buffer.concat([signature, chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]),
  );
}

describe("images", () => {
  const backend = Bun.Image.backend;
  beforeAll(() => void (Bun.Image.backend = "bun"));
  afterAll(() => void (Bun.Image.backend = backend));
  const gray = (x: number, y: number) => x ** 2 * 7 + y ** 2 * 31;

  it("the placeholder of one that has to be reduced first", async () => {
    const large = grayImage(400, 200, (x, y) => gray(x >> 2, y >> 2));
    expect(await large.placeholder()).toEqual(await grayImage(100, 50, gray).placeholder());
  });

  it.each([3, 5, 13, 135])("turned and mirrored, %i wide", async w => {
    for (const h of [1, 2, 3, 7, 18]) {
      const image = () => grayImage(w, h, gray);
      const actual = [image().rotate(90), image().rotate(180), image().rotate(270), image().flip(), image().flop()];
      const expected = [
        grayImage(h, w, (x, y) => gray(y, h - 1 - x)),
        grayImage(w, h, (x, y) => gray(w - 1 - x, h - 1 - y)),
        grayImage(h, w, (x, y) => gray(w - 1 - y, x)),
        grayImage(w, h, (x, y) => gray(x, h - 1 - y)),
        grayImage(w, h, (x, y) => gray(w - 1 - x, y)),
      ];
      const encoded = (images: Bun.Image[]) => Promise.all(images.map(it => it.png().bytes()));
      expect(await encoded(actual)).toEqual(await encoded(expected));
    }
  });
});

it("long strings, and strings with non-ASCII text", () => {
  const transpiler = new Bun.Transpiler();
  for (const quote of "\"'`") {
    const escapes = [quote, "\\", "\r\na", "\r\\\\"].map(it => "é\\" + it);
    for (const text of ["é", "éa", "éaaaa", ...escapes, "é$", "é${1}", "🦊", "a🦊🦊", plant(5000, 0, "a")]) {
      for (const after of ["", ";", ";;", ";;;", ";;;;"]) {
        const code = `globalThis.x = ${quote}${text}${quote}${after}`;
        expect(eval(transpiler.transformSync(code))).toBe(eval(code));
        expect(() => transpiler.transformSync(quote + text + after)).toThrow("Unterminated string literal");
        for (const wrong of quote === "`" ? ["${}"] : ["\r", "\n"]) {
          expect(() => transpiler.transformSync(quote + text + wrong + quote + after)).toThrow(
            quote === "`" ? "Unexpected }" : "Unterminated string literal",
          );
        }
      }
    }
  }
});

it("characters that end neither a comment nor a line", () => {
  const transpiler = new Bun.Transpiler();
  for (const n of [...LENGTHS, 600]) {
    for (const other of "\t\v\f$\u0085\u2027\u202a\u2068") {
      for (const after of ["", "b", "bb", "bbb", "bbbb"]) {
        const text = plant(n, n - 1, other) + after;
        expect(transpiler.transformSync("x//" + text)).toBe("x;\n");
        // A line break in the comment would end the statement.
        expect(() => transpiler.transformSync("x/*" + text + text + "*/y")).toThrow('Expected ";" but found "y"');
      }
    }
  }
});

it("pragmas behind other text in a comment", () => {
  const transpiler = new Bun.Transpiler({ loader: "jsx", treeShaking: true });
  for (const n of [0, ...LENGTHS, 600]) {
    for (const filler of [" ", "a ", "é ", "─ ", "#", "@"]) {
      const gap = Buffer.alloc(n * Buffer.byteLength(filler), filler).toString();
      const pragmas = gap + "@jsxRuntime classic " + gap + "@jsx h";
      // The URL is skipped whole.
      const url = "//" + pragmas + "\n//# sourceMappingURL=a@jsx k";
      for (const comment of ["//" + pragmas, "/*" + pragmas + "*/", "/*" + pragmas + " @*/", url]) {
        expect(transpiler.transformSync(comment + "\nx = <a/>")).toBe('x = h("a", null);\n');
      }
      for (const pure of ["@__PURE__", "#__PURE__"]) {
        expect(transpiler.transformSync("/*" + gap + pure + "*/f()")).toBe("");
        // In a line comment the annotation has to come first.
        expect(transpiler.transformSync("//" + gap + pure + "\nf()")).toBe(gap.trim() ? "f();\n" : "");
      }
    }
  }
});

it("ampersands in JSX and carriage returns in raw templates", () => {
  const transpiler = new Bun.Transpiler({ loader: "jsx" });
  // Used by the evaluated code.
  const h = (_: string, props: any, text: string) => [props.b, text];
  for (const [text, value] of [["&"], ["&;"], ["&a"], ["&:;"], ["&lt"], ["&#"], ["&lt;", "<"], ["&&lt;&", "&<&"]]) {
    for (const before of ["", "é", plant(70, 0, "a")]) {
      const code = `/* @jsxRuntime classic @jsx h */ globalThis.x = <a b="${before}${text}">${before}${text}</a>;`;
      expect(eval(transpiler.transformSync(code))).toEqual([before + (value ?? text), before + (value ?? text)]);
    }
  }
  for (const text of ["", "a", "\r", "a\r", "\r\n", "\ra", plant(70, 69, "\r")]) {
    const code = "globalThis.x = String.raw`" + text + "${1}" + text + "`\r";
    expect(transpiler.transformSync(code)).not.toContain("\r");
    expect(eval(transpiler.transformSync(code))).toBe(eval(code));
  }
});

it("wrapAnsi trims the line after an empty one", () => {
  expect(["a\n\n\t b", "a\r\n\r\n\t b", "─\n\n\t b"].map(text => Bun.wrapAnsi(text, 80))).toEqual([
    "a\n\nb",
    "a\n\nb",
    "─\n\nb",
  ]);
});

const bytes = (n: number) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 73 + (i >> 3) + n) & 255));

it.each([2, 4, 8])("swaps of %i bytes", size => {
  for (const n of [...LENGTHS, 1000]) {
    const from = bytes(n * size);
    const expected = from.map((_, i) => from[i ^ (size - 1)]);
    expect(Buffer.from(from)["swap" + size * 8]()).toEqual(expected);
  }
});

describe.each([
  ["8 bits", narrow],
  ["16 bits", wide],
])("%s", (_, make) => {
  it("hex, up to the first other character", () => {
    for (const n of LENGTHS) {
      const from = bytes(n);
      const hex = [...from].map((it, i) => (i % 3 ? it.toString(16) : it.toString(16).toUpperCase()).padStart(2, "0"));
      expect(Buffer.from(make(hex.join("")), "hex")).toEqual(from);
      expect(from.toString("hex")).toBe(hex.join("").toLowerCase());
      for (const at of spots(n)) {
        expect(Buffer.from(make(hex.with(at, "0g").join("")), "hex")).toEqual(from.subarray(0, at));
      }
    }
  });

  it("names of headers", () => {
    for (const n of LENGTHS) {
      for (const at of spots(n)) {
        for (const what of ["A", "Z", "^", "9"]) {
          const name = plant(n, at, what);
          expect([...new Headers([[make(name), "1"]]).keys()]).toEqual([name.toLowerCase()]);
        }
      }
    }
  });

  it("stripANSI behind other control characters", () => {
    for (const n of LENGTHS) {
      for (const at of spots(n)) {
        for (const other of ["a", "\x18a\x91"]) {
          const text = (what: string) => plant(40, 20, other) + plant(n, at, what) + Buffer.alloc(1100, "b");
          expect(Bun.stripANSI(make(text("\x1b[1m")))).toBe(text(""));
          expect(Bun.stripANSI(make(text("\x9b1m")))).toBe(text(""));
        }
      }
    }
  });

  it("stripANSI of many sequences in a row", () => {
    for (let gap = 0; gap < 40; gap++) {
      const parts = Array.from({ length: 30 }, (_, i) => "é[1;m~@".repeat(9).slice(i % 7, (i % 7) + gap));
      expect(Bun.stripANSI(make(parts.join("\x1b[38;5;1m")))).toBe(parts.join(""));
    }
  });

  it("stripANSI of so few sequences that the end has no room to spare", () => {
    for (let n = 92; n < 190; n++) {
      const text = String.fromCharCode(...bytes(n).map(it => it | 0xa0));
      for (const last of [0, 1, 5, 12, 20, 35, 50]) {
        const parts = ["a", "b", "c", text.slice(last), text.slice(0, last)];
        expect(Bun.stripANSI(make(parts.join("\x1b[m")))).toBe(parts.join(""));
      }
    }
  });

  it("UTF-8", () => {
    for (const n of LENGTHS) {
      for (const at of spots(n)) {
        expect(Buffer.from(make(plant(n, at, "é"))).toString("latin1")).toBe(plant(n, at, "Ã©"));
      }
    }
  });
});

it("latin1 of 16-bit strings", () => {
  for (const n of LENGTHS) {
    const from = bytes(n);
    expect(Buffer.from(String.fromCharCode(...[...from].map(it => it * 257)), "latin1")).toEqual(from);
  }
});

it("searches among near misses", () => {
  for (const needle of ["aba", "abaaaaaaaaaaaaaaaaaaba"]) {
    for (const at of [0, 1, 63, 64, 500, 3000, 4999]) {
      const text = plant(5000, at, needle);
      const buffer = Buffer.from(text);
      expect([buffer.indexOf(needle), buffer.lastIndexOf(needle)]).toEqual([at, at]);
      const units = Buffer.from(text, "utf16le");
      expect([units.indexOf(needle, 0, "utf16le"), units.lastIndexOf(needle, -2, "utf16le")]).toEqual([2 * at, 2 * at]);
    }
  }
});

it("inflates matches that are near", () => {
  const source = bytes(400);
  for (let distance = 1; distance <= 40; distance++) {
    const parts = LENGTHS.map(n => Buffer.alloc(distance + n + 2, source.subarray(n, n + distance)));
    for (const data of [parts[3], parts[16], Buffer.concat(parts), Buffer.concat(parts.toReversed())]) {
      const compressed = deflateRawSync(data);
      expect([Buffer.from(Bun.inflateSync(compressed)), inflateRawSync(compressed)]).toEqual([data, data]);
    }
  }
});

it("masks of WebSocket frames", async () => {
  using server = Bun.serve({
    port: 0,
    fetch: (request, server) => void server.upgrade(request),
    websocket: { message: (socket, message) => void socket.send(message) },
  });
  const sent = LENGTHS.flatMap(n => [bytes(n), plant(n, n >> 1, "b"), plant(n, n >> 1, "é"), plant(n, n >> 1, "─")]);
  const [received, done] = [[] as unknown[], Promise.withResolvers<void>()];
  const socket = new WebSocket(server.url.href.replace("http", "ws"));
  socket.onopen = () => sent.forEach(it => socket.send(it));
  socket.onclose = () => done.resolve();
  socket.onmessage = ({ data }) => received.push(data) === sent.length && socket.close();
  await done.promise;
  expect(received).toEqual(sent);
});
