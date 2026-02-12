import { describe, expect, test } from "bun:test";

const truncateAnsi = Bun.truncateAnsi;

describe("Bun.truncateAnsi", () => {
  test("main", () => {
    expect(truncateAnsi("unicorn", 4)).toBe("uni\u2026");
    expect(truncateAnsi("unicorn", 4, { position: "end" })).toBe("uni\u2026");
    expect(truncateAnsi("unicorn", 1)).toBe("\u2026");
    expect(truncateAnsi("unicorn", 0)).toBe("");
    expect(truncateAnsi("unicorn", -4)).toBe("");
    expect(truncateAnsi("unicorn", 20)).toBe("unicorn");
    expect(truncateAnsi("unicorn", 7)).toBe("unicorn");
    expect(truncateAnsi("unicorn", 6)).toBe("unico\u2026");
    expect(truncateAnsi("\u001B[31municorn\u001B[39m", 7)).toBe("\u001B[31municorn\u001B[39m");
    expect(truncateAnsi("\u001B[31municorn\u001B[39m", 1)).toBe("\u2026");
    expect(truncateAnsi("\u001B[31municorn\u001B[39m", 4)).toBe("\u001B[31muni\u2026\u001B[39m");
    expect(truncateAnsi("a\uD83C\uDE00b\uD83C\uDE00c", 5)).toBe("a\uD83C\uDE00b\u2026");
    expect(truncateAnsi("\u5B89\u5B81\u54C8\u4E16\u754C", 3)).toBe("\u5B89\u2026");
    expect(truncateAnsi("unicorn", 5, { position: "start" })).toBe("\u2026corn");
    expect(truncateAnsi("unicorn", 6, { position: "start" })).toBe("\u2026icorn");
    expect(truncateAnsi("unicorn", 5, { position: "middle" })).toBe("un\u2026rn");
    expect(truncateAnsi("unicorns", 6, { position: "middle" })).toBe("uni\u2026ns");
    expect(truncateAnsi("u", 1)).toBe("u");
  });

  test("space option", () => {
    expect(truncateAnsi("unicorns", 5, { position: "end", space: true })).toBe("uni \u2026");
    expect(truncateAnsi("unicorns", 6, { position: "start", space: true })).toBe("\u2026 orns");
    expect(truncateAnsi("unicorns", 7, { position: "middle", space: true })).toBe("uni \u2026 s");
    expect(truncateAnsi("unicorns", 5, { position: "end", space: false })).toBe("unic\u2026");
    expect(truncateAnsi("\u001B[31municorn\u001B[39m", 6, { space: true })).toBe("\u001B[31munic \u2026\u001B[39m");
    expect(truncateAnsi("Plant a tree every day.", 14, { space: true })).toBe("Plant a tree \u2026");
    expect(truncateAnsi("\u5B89\u5B81\u54C8\u4E16\u754C", 4, { space: true })).toBe("\u5B89 \u2026");
    expect(truncateAnsi("\u001B[31municorn\u001B[39m", 6, { position: "start", space: true })).toBe(
      "\u001B[31m\u2026 corn\u001B[39m",
    );
    expect(truncateAnsi("\u001B[31municornsareawesome\u001B[39m", 10, { position: "middle", space: true })).toBe(
      "\u001B[31munico\u001B[39m \u2026 \u001B[31mme\u001B[39m",
    );
    expect(truncateAnsi("Plant a tree every day.", 14, { position: "middle", space: true })).toBe(
      "Plant a \u2026 day.",
    );
    expect(truncateAnsi("\u5B89\u5B81\u54C8\u4E16\u754C", 4, { position: "start", space: true })).toBe("\u2026 \u754C");
  });

  test("preferTruncationOnSpace option", () => {
    expect(truncateAnsi("unicorns are awesome", 15, { position: "start", preferTruncationOnSpace: true })).toBe(
      "\u2026are awesome",
    );
    expect(truncateAnsi("dragons are awesome", 15, { position: "end", preferTruncationOnSpace: true })).toBe(
      "dragons are\u2026",
    );
    expect(truncateAnsi("unicorns rainbow dragons", 6, { position: "start", preferTruncationOnSpace: true })).toBe(
      "\u2026agons",
    );
    expect(truncateAnsi("unicorns rainbow dragons", 6, { position: "end", preferTruncationOnSpace: true })).toBe(
      "unico\u2026",
    );
    expect(
      truncateAnsi("unicorns rainbow dragons", 6, {
        position: "middle",
        preferTruncationOnSpace: true,
      }),
    ).toBe("uni\u2026ns");
    expect(
      truncateAnsi("unicorns partying with dragons", 20, {
        position: "middle",
        preferTruncationOnSpace: true,
      }),
    ).toBe("unicorns\u2026dragons");
  });

  test("truncationCharacter option", () => {
    expect(truncateAnsi("unicorns", 5, { position: "end", truncationCharacter: "." })).toBe("unic.");
    expect(truncateAnsi("unicorns", 5, { position: "start", truncationCharacter: "." })).toBe(".orns");
    expect(truncateAnsi("unicorns", 5, { position: "middle", truncationCharacter: "." })).toBe("un.ns");
    expect(truncateAnsi("unicorns", 5, { position: "end", truncationCharacter: ".", space: true })).toBe("uni .");
    expect(truncateAnsi("unicorns", 5, { position: "end", truncationCharacter: " ." })).toBe("uni .");
    expect(
      truncateAnsi("unicorns partying with dragons", 20, {
        position: "middle",
        truncationCharacter: ".",
        preferTruncationOnSpace: true,
      }),
    ).toBe("unicorns.dragons");
    expect(
      truncateAnsi("\u5B89\u5B81\u54C8\u4E16\u754C", 4, {
        position: "start",
        space: true,
        truncationCharacter: ".",
      }),
    ).toBe(". \u754C");
    expect(
      truncateAnsi("\u001B[31municornsareawesome\u001B[39m", 10, {
        position: "middle",
        space: true,
        truncationCharacter: ".",
      }),
    ).toBe("\u001B[31munico\u001B[39m . \u001B[31mme\u001B[39m");
  });

  test("custom truncation character inherits style (end/start)", () => {
    const red = "\u001B[31m";
    const reset = "\u001B[39m";
    const text = `${red}unicorns${reset}`;
    const endOut = truncateAnsi(text, 5, { truncationCharacter: "." });
    const startOut = truncateAnsi(text, 5, { position: "start", truncationCharacter: "." });
    expect(endOut.startsWith(red)).toBe(true);
    expect(endOut.includes(".")).toBe(true);
    expect(endOut.endsWith(reset)).toBe(true);
    expect(startOut.startsWith(red)).toBe(true);
    expect(startOut.includes(".")).toBe(true);
    expect(startOut.endsWith(reset)).toBe(true);
  });

  test("styled truncation character inherits for start and end", () => {
    const red = "\u001B[31m";
    const cyan = "\u001B[36m";
    const reset = "\u001B[39m";

    // Test end position
    const endText = `${red}unicorns${reset}`;
    const endOut = truncateAnsi(endText, 5);
    expect(endOut).toBe(`${red}unic\u2026${reset}`);

    // Test start position
    const startText = `hello ${cyan}unicorns${reset}`;
    const startOut = truncateAnsi(startText, 5, { position: "start" });
    expect(startOut.startsWith(cyan)).toBe(true);
    expect(startOut.includes("\u2026")).toBe(true);
    expect(startOut.endsWith(reset)).toBe(true);
  });

  test("edge cases", () => {
    // Empty string
    expect(truncateAnsi("", 5)).toBe("");

    // Whitespace only
    expect(truncateAnsi("     ", 3)).toBe("  \u2026");

    // Multiple ANSI codes
    const multiAnsi = "\u001B[31m\u001B[1municorns\u001B[22m\u001B[39m";
    expect(truncateAnsi(multiAnsi, 5)).toBe("\u001B[31m\u001B[1munic\u2026\u001B[22m\u001B[39m");

    // Columns = 2
    expect(truncateAnsi("test", 2)).toBe("t\u2026");

    // Very long truncation character
    expect(truncateAnsi("unicorns", 5, { truncationCharacter: "..." })).toBe("un...");
  });

  test("preserves ANSI escape codes at the end - issue #24", () => {
    const red = "\u001B[31m";
    const reset = "\u001B[39m";

    // Text with ANSI codes at the end
    const text = `Hello ${red}World${reset}`;

    // When not truncated, preserve everything
    expect(truncateAnsi(text, 11)).toBe(`Hello ${red}World${reset}`);

    // When truncated at the end, ellipsis should inherit the style
    expect(truncateAnsi(text, 8)).toBe(`Hello ${red}W\u2026${reset}`);

    // When truncated at start
    expect(truncateAnsi(text, 8, { position: "start" })).toBe(`\u2026o ${red}World${reset}`);

    // Text ending with reset only
    const textEndingWithReset = `Hello World${reset}`;
    expect(truncateAnsi(textEndingWithReset, 11)).toBe(`Hello World${reset}`);
    expect(truncateAnsi(textEndingWithReset, 8)).toBe("Hello W\u2026");
  });

  test("position as string shorthand", () => {
    expect(truncateAnsi("unicorn", 5, "start")).toBe("\u2026corn");
    expect(truncateAnsi("unicorn", 5, "middle")).toBe("un\u2026rn");
    expect(truncateAnsi("unicorn", 4, "end")).toBe("uni\u2026");
  });
});
