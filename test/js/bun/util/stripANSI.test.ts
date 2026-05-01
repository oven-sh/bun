import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import stripAnsi from "strip-ansi";

describe("Bun.stripANSI", () => {
  test("returns same string object when no ANSI sequences present", () => {
    var input = "hello world";
    const stripANSI = Bun.stripANSI;
    const numStrings = heapStats().objectTypeCounts.string;
    const result = stripANSI(input);
    // Make sure the string wasn't modified
    expect(result).toBe(input);
    // Verify it's the same object, not a copy
    expect(heapStats().objectTypeCounts.string).toBe(numStrings);
  });

  test("returns new string when ANSI sequences are removed", () => {
    const input = "\x1b[31mhello\x1b[0m world";
    const result = Bun.stripANSI(input);
    expect(result).toBe("hello world");
    // Verify it's a different object
    expect(result === input).toBe(false);
  });

  // Tests of the form [input, expected] are used when strip-ansi's behavior
  // is incorrect or undesirable.
  const testCases: (string | [string, string])[] = [
    // Basic colors
    "\x1b[31mred\x1b[39m",
    "\x1b[32mgreen\x1b[39m",
    "\x1b[33myellow\x1b[39m",
    "\x1b[34mblue\x1b[39m",
    "\x1b[35mmagenta\x1b[39m",
    "\x1b[36mcyan\x1b[39m",
    "\x1b[37mwhite\x1b[39m",

    // Background colors
    "\x1b[41mred background\x1b[49m",
    "\x1b[42mgreen background\x1b[49m",

    // Text styles
    "\x1b[1mbold\x1b[22m",
    "\x1b[2mdim\x1b[22m",
    "\x1b[3mitalic\x1b[23m",
    "\x1b[4munderline\x1b[24m",
    "\x1b[5mblink\x1b[25m",
    "\x1b[7mreverse\x1b[27m",
    "\x1b[8mhidden\x1b[28m",
    "\x1b[9mstrikethrough\x1b[29m",

    // 256 colors
    "\x1b[38;5;196mred\x1b[39m",
    "\x1b[48;5;196mred background\x1b[49m",

    // RGB colors
    "\x1b[38;2;255;0;0mred\x1b[39m",
    "\x1b[48;2;255;0;0mred background\x1b[49m",

    // Cursor movement
    "\x1b[2Aup",
    "\x1b[2Bdown",
    "\x1b[2Cforward",
    "\x1b[2Dback",
    "\x1b[Hhome",
    "\x1b[2;3Hposition",

    // Erase sequences
    "\x1b[2Jclear",
    "\x1b[Kclear line",
    "\x1b[1Kclear line before",
    "\x1b[2Kclear entire line",

    // Combined sequences
    "\x1b[1;31mbold red\x1b[0m",
    "\x1b[1;4;31mbold underline red\x1b[0m",
    "\x1b[31;42mred on green\x1b[0m",

    // Nested sequences
    "\x1b[31mred \x1b[1mbold\x1b[22m red\x1b[39m",
    "\x1b[31m\x1b[32m\x1b[33myellow\x1b[39m",

    // OSC sequences
    ["\x1b]0;window title\x07text", "text"],
    ["\x1b]0;window title\x1b\\text", "text"],
    "\x1b]8;;https://example.com\x07link\x1b]8;;\x07",

    // Other escape sequences
    "\x1b(Btext",
    "\x1b)Btext",
    ["\x1b*Btext", "text"],
    ["\x1b+Btext", "text"],
    "\x1b=text",
    "\x1b>text",
    "\x1bDtext",
    "\x1bEtext",
    "\x1bHtext",
    "\x1bMtext",
    ["\x1b7text", "text"],
    ["\x1b8text", "text"],
    ["\x1b#8text", "text"],
    ["\x1b%Gtext", "text"],

    // No ANSI codes
    "plain text",
    "",
    "hello world",

    // Partial sequences
    ["text\x1b", "text"],
    ["text\x1b[", "text"],
    "text\x1b[3",

    // Real world examples
    "\x1b[2K\x1b[1G\x1b[36m?\x1b[39m Installing...",
    "\x1b[32m+ added\x1b[39m\n\x1b[31m- removed\x1b[39m",
    "\x1b[1A\x1b[2K\x1b[32m████████\x1b[39m 100%",

    // Unicode handling
    "\x1b[31m你好\x1b[39m",
    "\x1b[32m😀\x1b[39m",
    "\x1b[33m🚀 rocket\x1b[39m",

    // SGR parameters
    "\x1b[0;1;31mtext\x1b[0m",
    "\x1b[;;mtext",
    "\x1b[1;;31mtext\x1b[m",

    // Reset sequences
    "\x1b[0mtext",
    "\x1b[mtext",
    "text\x1b[0m",
    "text\x1b[m",

    // Malformed sequences
    "\x1b[31text",
    "\x1b[moretext",
    ["\x1b]incomplete", ""],
    ["\x1b]", ""],
    "\x1b]i",
    ["\x1b]in", ""],
    ["\x1b]inc", ""],

    // Preserves whitespace
    "\x1b[31m  text  \x1b[39m",
    "\x1b[31m\ttext\t\x1b[39m",
    "\x1b[31m\ntext\n\x1b[39m",

    // Edge cases
    "\x1b[mtext",
    "\x1b[0m\x1b[0m\x1b[0mtext",
    "text\x1b[31m",
    "\x1b[31m\x1b[32m\x1b[33m",

    // OSC sequences (Operating System Commands)
    ["\x1b]0;title\x07text", "text"],
    ["\x1b]0;window title\x1b\\text", "text"],
    ["\x1b]2;title\x07", ""],
    ["\x1b]8;;https://example.com\x07link text\x1b]8;;\x07", "link text"],
    ["\x1b]8;;file:///path/to/file\x1b\\clickable\x1b]8;;\x1b\\", "clickable"],

    // C1 CSI sequences (using 0x9B instead of ESC[)
    "\x9b31mtext\x9b39m",
    "\x9b2Ktext",
    "\x9b1Atext",

    // Complex CSI parameters
    "\x1b[38;5;196mred text\x1b[0m",
    "\x1b[38;2;255;0;0mrgb red\x1b[0m",
    "\x1b[48;5;21mblue bg\x1b[0m",
    "\x1b[1;4;31mbold underline red\x1b[0m",

    // Cursor movement
    "\x1b[10Atext",
    "\x1b[5Btext",
    "\x1b[20Ctext",
    "\x1b[15Dtext",
    "\x1b[2;5Htext",
    "\x1b[Ktext",
    "\x1b[2Jtext",

    // Save/restore cursor
    ["\x1b[stext\x1b[u", "text"],
    ["\x1b7text\x1b8", "text"],

    // Scroll sequences
    "\x1b[5Stext",
    "\x1b[3Ttext",

    // Alternative CSI final bytes
    "\x1b[?25htext", // show cursor
    "\x1b[?25ltext", // hide cursor
    ["\x1b[=3htext", "text"],
    ["\x1b[>5ctext", "text"],
    ["\x1b[<6~text", "text"],

    // Prefix characters in sequences
    "\x1b[?1049htext",
    ["\x1b]#text", ""], // missing ST
    "\x1b[(text",
    "\x1b[)text",
    "\x1b[;text",

    // Multiple parameters with empty values
    "\x1b[;5;mtext",
    "\x1b[31;;39mtext",
    "\x1b[;;;mtext",

    // Large parameter numbers
    ["\x1b[12345mtext", "text"],
    "\x1b[1234mtext",
    "\x1b[9999;1234mtext",

    // String terminator variations
    ["\x1b]0;title\x9ctext", "text"], // 0x9C terminator
    ["\x1b]2;test\x07more", "more"],

    // Mixed sequences
    ["\x1b[31m\x1b]0;title\x07\x1b[39mtext", "text"],
    ["\x1b]8;;\x07\x1b[4mlink\x1b[24m\x1b]8;;\x07", "link"],

    // Sequences at boundaries
    "\x1b[31m",
    "\x1b[31mtext\x1b[39m\x1b[32m",
    "start\x1b[31mtext\x1b[39mend",

    // Invalid but should be partially consumed
    "\x1b[31invalid", // 3 should be consumed as CSI final
    "\x1b[9invalid", // 9 should be consumed as CSI final
    "\x1b[Zinvalid", // Z should be consumed as CSI final

    // Very long parameter sequences
    "\x1b[1;2;3;4;5;6;7;8;9;10;11;12mtext\x1b[0m",
    "\x1b[" + "1;".repeat(100) + "mtext",

    // Nested-looking sequences (not actually nested)
    ["\x1b[31m\x1b in text\x1b[39m", "n text"], // ESC SP <x> is a two-byte sequence
    ["\x1b]0;\x1b[31mred\x1b[39m\x07text", "text"],

    // Control characters mixed with ANSI
    "\x1b[31m\x08\x09\x0a\x0d\x1b[39m",

    // Real terminal sequences
    "\x1b[?1049h\x1b[22;0;0t\x1b[1;1H\x1b[2Jtext",
    "\x1b[H\x1b[2J\x1b[3J", // clear screen sequence
    "\x1b[6n", // cursor position query

    // Edge cases with C1 CSI (0x9B)
    "\x9b31mtext\x9b39m",
    ["\x9b[31mtext", "31mtext"], // 0x9B followed by [ is invalid
    "\x9bHtext", // Cursor Home
    "\x9b2Jtext", // Clear Screen

    // OSC sequences with various terminators
    ["\x1b]0;Window Title\x1b\\text", "text"], // ESC \ terminator
    ["\x1b]1;Icon Name\x07text", "text"], // BEL terminator
    ["\x1b]2;Both\x9ctext", "text"], // ST terminator
    ["\x1b]8;;http://example.com\x07", ""], // Hyperlink OSC

    // Invalid OSC sequences (missing terminator)
    ["\x1b]0;title", ""], // No terminator, consumes rest
    ["\x1b]2;test\x1bother", ""], // Incomplete ESC terminator

    // Complex prefix combinations
    ["\x1b[[[31mtext", "[31mtext"], // [ terminates CSI
    ["\x1b]]]]0;title\x07text", "text"],
    ["\x1b()()#;?31mtext", "()#;?31mtext"], // ESC ( <x> is a two-byte sequence
    ["\x1b#?#?[31mtext", "#?[31mtext"], // ESC # <x> is a two-byte sequence

    // CSI sequences with intermediate bytes
    ["\x1b[!ptext", "text"], // DECSTR
    ['\x1b["qtext', "text"], // DECSCA
    ["\x1b[$ptext", "text"], // DECRQM
    ["\x1b[%@text", "text"], // Select UTF-8

    // Private mode sequences
    "\x1b[?25htext", // Show cursor
    "\x1b[?25ltext", // Hide cursor
    "\x1b[?1049htext", // Alternative screen buffer
    "\x1b[?2004htext", // Bracketed paste mode

    // SGR (Select Graphic Rendition) variations
    "\x1b[38;5;196mtext", // 256-color foreground
    "\x1b[48;2;255;0;0mtext", // RGB background
    "\x1b[38;2;0;255;0;48;5;17mtext", // Mixed RGB and 256-color

    // Function key sequences
    "\x1b[11~text", // F1
    "\x1b[24~text", // F12
    "\x1b[1;5Ptext", // Ctrl+F1

    // Cursor movement sequences
    "\x1b[10;20Htext", // Cursor position
    "\x1b[5Atext", // Cursor up
    "\x1b[3Btext", // Cursor down
    "\x1b[2Ctext", // Cursor right
    "\x1b[4Dtext", // Cursor left

    // Erase sequences
    "\x1b[0Ktext", // Erase to end of line
    "\x1b[1Ktext", // Erase to beginning of line
    "\x1b[2Ktext", // Erase entire line
    "\x1b[0Jtext", // Erase to end of screen
    "\x1b[1Jtext", // Erase to beginning of screen
    "\x1b[2Jtext", // Erase entire screen
    "\x1b[3Jtext", // Erase scrollback buffer

    // Save/restore cursor
    ["\x1b[stext\x1b[u", "text"], // Save and restore cursor
    ["\x1b7text\x1b8", "text"], // Save and restore cursor (alternate)

    // Scroll sequences
    "\x1b[5Stext", // Scroll up
    "\x1b[3Ttext", // Scroll down
    "\x1bMtext", // Reverse line feed
    "\x1bDtext", // Line feed

    // Tab sequences
    "\x1b[3gtext", // Clear tab stop
    "\x1b[0gtext", // Clear tab stop at cursor
    "\x1bHtext", // Set tab stop

    // Insert/delete sequences
    ["\x1b[5@text", "text"], // Insert characters
    "\x1b[3Ptext", // Delete characters
    "\x1b[2Ltext", // Insert lines
    "\x1b[4Mtext", // Delete lines

    // Mode setting sequences
    "\x1b[4htext", // Insert mode
    "\x1b[4ltext", // Replace mode
    "\x1b[20htext", // Automatic newline
    "\x1b[20ltext", // Normal linefeed

    // Device status report
    "\x1b[5ntext", // Device status report
    "\x1b[6ntext", // Cursor position report
    "\x1b[?15ntext", // Printer status report

    // Character sets
    "\x1b(Atext", // UK character set
    "\x1b)Btext", // US character set
    ["\x1b*0text", "text"], // DEC special character set
    ["\x1b+Btext", "text"], // G3 character set

    // Double-width/height sequences
    ["\x1b#3text", "text"], // Double-height line (top half)
    ["\x1b#4text", "text"], // Double-height line (bottom half)
    ["\x1b#5text", "text"], // Single-width line
    ["\x1b#6text", "text"], // Double-width line

    // Malformed sequences that should partially match
    "\x1b[31", // Incomplete CSI (no final byte)
    ["\x1b[31;", ""], // Incomplete parameters
    "\x1b[31;4", // Incomplete parameters
    ["\x1b]0;title", ""], // Incomplete OSC
    ["\x1b]0;title\x1b", ""], // Incomplete OSC terminator

    // Sequences with invalid parameters
    ["\x1b[99999mtext", "text"], // Parameter too long (>4 digits), but strip anyway
    "\x1b[;;;;;mtext", // Multiple empty parameters
    "\x1b[1;2;3;4;5;6;7;8;9;10;11;12;13;14;15;16;17;18;19;20mtext", // Many parameters

    // Mixed valid and invalid sequences
    "\x1b[31mred\x1binvalid\x1b[39mnormal",
    "\x1b]0;title\x07\x1binvalid\x1b[32mgreen",

    // Unicode content in sequences
    ["\x1b]0;タイトル\x07text", "text"], // Japanese in OSC
    ["\x1b]2;🚀 rocket\x07text", "text"], // Emoji in OSC
    "\x1b[31m🌈 rainbow\x1b[39m after",

    // Zero-width sequences
    "\x1b[0mtext", // Reset all attributes
    "\x1b[mtext", // Reset all attributes (no parameters)
    "\x1b[;mtext", // Reset with empty parameter

    // Application keypad sequences
    "\x1b=text", // Application keypad mode
    "\x1b>text", // Numeric keypad mode

    // Bracketed paste sequences
    "\x1b[200~pasted\x1b[201~text",

    // Focus events
    "\x1b[Itext", // Focus in
    "\x1b[Otext", // Focus out

    // Multiple sequences of varying lengths
    "\x1b[31m\x1b[32m\x1b[33m\x1b[34m\x1b[35m\x1b[36m\x1b[37mtext", // 7 short sequences
    "\x1b[38;5;196m\x1b[48;5;21m\x1b[1m\x1b[4mtext\x1b[0m", // Mixed length sequences
    "\x1b[31mred\x1b[32mgreen\x1b[33myellow\x1b[34mblue\x1b[39mnormal",

    // Long sequences (>16 characters)
    "\x1b[38;2;255;128;64;48;5;196;1;4;9;7mtext", // Very long CSI with many parameters
    ["\x1b]0;This is a very long window title that exceeds 16 characters\x07text", "text"], // Long OSC
    "\x1b]8;;https://very-long-domain-name.example.com/path/to/resource\x07link\x1b]8;;\x07", // Long URL in OSC
    "\x1b[38;2;255;255;255;48;2;128;128;128;1;3;4;9mstyledtext\x1b[0m", // RGB colors with attributes

    // Multiple long sequences
    [
      "\x1b]0;Window Title\x07\x1b[38;2;255;0;0;48;2;0;255;0mcolorful\x1b[0m\x1b]8;;https://example.com\x07link\x1b]8;;\x07",
      "colorfullink",
    ],
    "\x1b[38;5;196;48;5;21;1;4;9mstyle1\x1b[38;5;46;48;5;201;22;24;29mstyle2\x1b[0m",

    // Sequences with maximum parameter counts
    "\x1b[1;2;3;4;5;6;7;8;9;10;11;12;13;14;15;16;17;18;19;20;21;22;23;24;25;26;27;28;29;30mtext",
    "\x1b[255;255;255;255;255;255;255;255;255;255;255;255;255;255;255;255;255;255;255;255mtext",

    // Mixed short and long sequences in succession
    "\x1b[31m\x1b[38;2;255;0;0;48;2;0;255;0;1;4;9m\x1b[32m\x1b[38;5;196;48;5;21;22;24mtext",
    "\x1b[H\x1b[2J\x1b[38;2;255;255;255;48;2;0;0;0;1;3;4;7;9;53mstyledtext\x1b[0m\x1b[K",

    // Long OSC sequences with various terminators
    ["\x1b]0;Title with special chars !@#$%^&*()_+-=[]{}|;:,.<>?\x07text", "text"],
    "\x1b]8;;https://user:pass@subdomain.example.com:8080/path/to/resource?query=value#fragment\x07hyperlink\x1b]8;;\x07",
    ["\x1b]2;Icon name with unicode: 🚀🌈⭐💎🎯\x1b\\text", "text"],

    // Sequences that span SIMD boundaries (assuming 16-byte chunks)
    "\x1b[31m123456789012345\x1b[32mtext", // Crosses 16-byte boundary
    "12345678901234567\x1b[31mtext", // ANSI starts after 16 bytes
    "123456789012345\x1b[38;2;255;0;0mtext", // Long sequence after 15 chars

    // Multiple sequences with content between that crosses SIMD boundaries
    "\x1b[31m12345678901234567890\x1b[32m12345678901234567890\x1b[33mtext",
    "prefix\x1b[31m12345678901234567890\x1b[32mmiddle\x1b[33m12345678901234567890suffix",

    // Very long content with scattered sequences
    "a".repeat(100) + "\x1b[31m" + "b".repeat(50) + "\x1b[32m" + "c".repeat(100),
    "\x1b[31m" + "x".repeat(200) + "\x1b[32m" + "y".repeat(200) + "\x1b[0m",

    // Complex mixed sequences with varying parameter lengths
    "\x1b[1m\x1b[38;5;196m\x1b[48;2;255;255;255m\x1b[4;9;53mcomplex\x1b[22;24;29;49;39mtext",
    "\x1b]0;\x07\x1b[31;32;33;34;35;36;37mcolors\x1b[0m\x1b]8;;\x07",

    // Alternating short and long sequences
    "\x1b[31m\x1b[38;2;255;0;0;48;2;0;255;0m\x1b[32m\x1b[38;5;196;48;5;21;1;4mtext",
    "\x1b[H\x1b[38;2;255;255;255;48;2;0;0;0;1;3;4;7;9mstyle\x1b[K\x1b[38;5;46mmore\x1b[0m",

    // Strip a single escape character
    ["\x1b", ""],
  ];

  for (const testCase of testCases) {
    let input;
    let expected;
    if (testCase instanceof Array) {
      [input, expected] = testCase;
    } else {
      input = testCase;
      expected = stripAnsi(input);
    }
    test(JSON.stringify(input), () => {
      const received = Bun.stripANSI(input);
      expect(Bun.stripANSI(input), `${JSON.stringify(expected)} != ${JSON.stringify(received)}`).toBe(expected);
    });
  }

  test("long strings", () => {
    const longText = "a".repeat(10000);
    const withAnsi = `\x1b[31m${longText}\x1b[39m`;
    expect(Bun.stripANSI(withAnsi)).toBe(stripAnsi(withAnsi));
  });

  test("multiple sequences in long string", () => {
    const parts = [];
    for (let i = 0; i < 1000; i++) {
      parts.push(`\x1b[${30 + (i % 8)}mword${i}\x1b[39m`);
    }
    const input = parts.join(" ");
    expect(Bun.stripANSI(input)).toBe(stripAnsi(input));
  });

  test("non-string input", () => {
    expect(Bun.stripANSI(123 as any)).toBe("123");
    expect(Bun.stripANSI(true as any)).toBe("true");
    expect(Bun.stripANSI(false as any)).toBe("false");
    expect(Bun.stripANSI(null as any)).toBe("null");
    expect(Bun.stripANSI(undefined as any)).toBe("undefined");
  });
});
