import { escapeHTML } from "bun";
import { describe, expect, it } from "bun:test";

describe("escapeHTML", () => {
  // The matrix of cases we need to test for:
  // 1. Works with short strings
  // 2. Works with long strings
  // 3. Works with latin1 strings
  // 4. Works with utf16 strings
  // 5. Works when the text to escape is somewhere in the middle
  // 6. Works when the text to escape is in the beginning
  // 7. Works when the text to escape is in the end
  // 8. Returns the same string when there's no need to escape
  it("works", () => {
    expect(escapeHTML("absolutely nothing to do here")).toBe("absolutely nothing to do here");
    expect(escapeHTML("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(escapeHTML("<")).toBe("&lt;");
    expect(escapeHTML(">")).toBe("&gt;");
    expect(escapeHTML("&")).toBe("&amp;");
    expect(escapeHTML("'")).toBe("&#x27;");
    expect(escapeHTML('"')).toBe("&quot;");
    expect(escapeHTML("\n")).toBe("\n");
    expect(escapeHTML("\r")).toBe("\r");
    expect(escapeHTML("\t")).toBe("\t");
    expect(escapeHTML("\f")).toBe("\f");
    expect(escapeHTML("\v")).toBe("\v");
    expect(escapeHTML("\b")).toBe("\b");
    expect(escapeHTML("\u00A0")).toBe("\u00A0");
    expect(escapeHTML("<script>ab")).toBe("&lt;script&gt;ab");
    expect(escapeHTML("<script>")).toBe("&lt;script&gt;");
    expect(escapeHTML("<script><script>")).toBe("&lt;script&gt;&lt;script&gt;");

    expect(escapeHTML("lalala" + "<script>alert(1)</script>" + "lalala")).toBe(
      "lalala&lt;script&gt;alert(1)&lt;/script&gt;lalala",
    );

    expect(escapeHTML("<script>alert(1)</script>" + "lalala")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;lalala");
    expect(escapeHTML("lalala" + "<script>alert(1)</script>")).toBe("lalala" + "&lt;script&gt;alert(1)&lt;/script&gt;");

    expect(escapeHTML("What does 😊 mean?")).toBe("What does 😊 mean?");
    const output = escapeHTML("<What does 😊");
    expect(output).toBe("&lt;What does 😊");
    expect(escapeHTML("<div>What does 😊 mean in text?")).toBe("&lt;div&gt;What does 😊 mean in text?");

    expect(escapeHTML(("lalala" + "<script>alert(1)</script>" + "lalala").repeat(900))).toBe(
      "lalala&lt;script&gt;alert(1)&lt;/script&gt;lalala".repeat(900),
    );
    expect(escapeHTML(("<script>alert(1)</script>" + "lalala").repeat(900))).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;lalala".repeat(900),
    );
    expect(escapeHTML(("lalala" + "<script>alert(1)</script>").repeat(900))).toBe(
      ("lalala" + "&lt;script&gt;alert(1)&lt;/script&gt;").repeat(900),
    );

    // the positions of the unicode codepoint are important
    // our simd code for U16 is at 8 bytes, so we need to especially check the boundaries
    expect(escapeHTML("😊lalala" + "<script>alert(1)</script>" + "lalala")).toBe(
      "😊lalala&lt;script&gt;alert(1)&lt;/script&gt;lalala",
    );
    expect(escapeHTML("<script>😊alert(1)</script>" + "lalala")).toBe("&lt;script&gt;😊alert(1)&lt;/script&gt;lalala");
    expect(escapeHTML("<script>alert(1)😊</script>" + "lalala")).toBe("&lt;script&gt;alert(1)😊&lt;/script&gt;lalala");
    expect(escapeHTML("<script>alert(1)</script>" + "😊lalala")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;😊lalala");
    expect(escapeHTML("<script>alert(1)</script>" + "lal😊ala")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;lal😊ala");
    expect(escapeHTML("<script>alert(1)</script>" + "lal😊ala".repeat(10))).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;" + "lal😊ala".repeat(10),
    );

    for (let i = 1; i < 10; i++)
      expect(escapeHTML("<script>alert(1)</script>" + "la😊".repeat(i))).toBe(
        "&lt;script&gt;alert(1)&lt;/script&gt;" + "la😊".repeat(i),
      );

    expect(escapeHTML("la😊" + "<script>alert(1)</script>")).toBe("la😊" + "&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(escapeHTML(("lalala" + "<script>alert(1)</script>😊").repeat(1))).toBe(
      ("lalala" + "&lt;script&gt;alert(1)&lt;/script&gt;😊").repeat(1),
    );

    expect(escapeHTML("😊".repeat(100))).toBe("😊".repeat(100));
    expect(escapeHTML("😊<".repeat(100))).toBe("😊&lt;".repeat(100));
    expect(escapeHTML("<😊>".repeat(100))).toBe("&lt;😊&gt;".repeat(100));
    expect(escapeHTML("😊")).toBe("😊");
    expect(escapeHTML("😊😊")).toBe("😊😊");
    expect(escapeHTML("😊lo")).toBe("😊lo");
    expect(escapeHTML("lo😊")).toBe("lo😊");

    expect(escapeHTML(" ".repeat(32) + "😊")).toBe(" ".repeat(32) + "😊");
    expect(escapeHTML(" ".repeat(32) + "😊😊")).toBe(" ".repeat(32) + "😊😊");
    expect(escapeHTML(" ".repeat(32) + "😊lo")).toBe(" ".repeat(32) + "😊lo");
    expect(escapeHTML(" ".repeat(32) + "lo😊")).toBe(" ".repeat(32) + "lo😊");
  });

  it("bad input doesn't crash", () => {
    escapeHTML("a".repeat(512) + String.fromCodePoint(0xd800));

    for (let i = 0; i < 768; i++) {
      escapeHTML("\xff" + "a".repeat(i));
      escapeHTML(String.fromCodePoint(0xd800) + "a".repeat(i));
      escapeHTML("a".repeat(i) + String.fromCodePoint(0xd800));
      escapeHTML(String.fromCodePoint(0xd800).repeat(i));
      escapeHTML("\xff" + String.fromCodePoint(0xd800).repeat(i));
      escapeHTML("\xff".repeat(i) + String.fromCodePoint(0xd800));
      escapeHTML(String.fromCodePoint(0xd800) + "\xff".repeat(i));
    }
  });

  it("escapes metacharacters adjacent to lone surrogates", () => {
    expect(escapeHTML("\uD800<x")).toBe("\uD800&lt;x");
    expect(escapeHTML("\uD800>x")).toBe("\uD800&gt;x");
    expect(escapeHTML("\uD800<img src=x onerror=alert(1)\uD800>")).toBe(
      "\uD800&lt;img src=x onerror=alert(1)\uD800&gt;",
    );
    expect(escapeHTML(("\uD800<" + "a".repeat(14)).repeat(8))).toBe(("\uD800&lt;" + "a".repeat(14)).repeat(8));
    expect(escapeHTML("\uD800a😊<b")).toBe("\uD800a😊&lt;b");
  });

  it("fuzz latin1", () => {
    for (let i = 0; i < 256; i++) {
      const initial = Buffer.alloc(i + 1, "a");
      for (let j = 0; j < i; j++) {
        const clone = Buffer.from(initial);
        clone[j] = ">".charCodeAt(0);
        Bun.escapeHTML(clone.toString());
      }
    }
  });

  it("fuzz utf16", () => {
    for (let i = 0; i < 256; i++) {
      const initial = new Uint16Array(i);
      initial.fill("a".charCodeAt(0));

      for (let j = 0; j < i; j++) {
        const clone = Buffer.from(initial);
        clone[j] = ">".charCodeAt(0);
        Bun.escapeHTML(clone.toString("utf16le"));
      }
    }
  });
});
