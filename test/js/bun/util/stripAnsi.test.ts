import { describe, expect, test } from "bun:test";
import stripAnsi from "strip-ansi";

describe("Bun.stripAnsi", () => {
  test("returns same string object when no ANSI sequences present", () => {
    const input = "hello world";
    const result = Bun.stripAnsi(input);
    expect(result).toBe(input);
    // Verify it's the same object, not a copy
    expect(result === input).toBe(true);
  });

  test("returns new string when ANSI sequences are removed", () => {
    const input = "\x1b[31mhello\x1b[0m world";
    const result = Bun.stripAnsi(input);
    expect(result).toBe("hello world");
    // Verify it's a different object
    expect(result === input).toBe(false);
  });

  test("returns same string when escape chars present but no valid ANSI", () => {
    const input = "\x1b";
    const result = Bun.stripAnsi(input);
    expect(result).toBe(input);
    // This should return the same object since nothing was stripped
    expect(result === input).toBe(true);
  });
  const testCases: Array<[string, string]> = [
    // Basic colors
    ["\x1b[31mred\x1b[39m", "red"],
    ["\x1b[32mgreen\x1b[39m", "green"],
    ["\x1b[33myellow\x1b[39m", "yellow"],
    ["\x1b[34mblue\x1b[39m", "blue"],
    ["\x1b[35mmagenta\x1b[39m", "magenta"],
    ["\x1b[36mcyan\x1b[39m", "cyan"],
    ["\x1b[37mwhite\x1b[39m", "white"],

    // Background colors
    ["\x1b[41mred background\x1b[49m", "red background"],
    ["\x1b[42mgreen background\x1b[49m", "green background"],

    // Text styles
    ["\x1b[1mbold\x1b[22m", "bold"],
    ["\x1b[2mdim\x1b[22m", "dim"],
    ["\x1b[3mitalic\x1b[23m", "italic"],
    ["\x1b[4munderline\x1b[24m", "underline"],
    ["\x1b[5mblink\x1b[25m", "blink"],
    ["\x1b[7mreverse\x1b[27m", "reverse"],
    ["\x1b[8mhidden\x1b[28m", "hidden"],
    ["\x1b[9mstrikethrough\x1b[29m", "strikethrough"],

    // 256 colors
    ["\x1b[38;5;196mred\x1b[39m", "red"],
    ["\x1b[48;5;196mred background\x1b[49m", "red background"],

    // RGB colors
    ["\x1b[38;2;255;0;0mred\x1b[39m", "red"],
    ["\x1b[48;2;255;0;0mred background\x1b[49m", "red background"],

    // Cursor movement
    ["\x1b[2Aup", "up"],
    ["\x1b[2Bdown", "down"],
    ["\x1b[2Cforward", "forward"],
    ["\x1b[2Dback", "back"],
    ["\x1b[Hhome", "home"],
    ["\x1b[2;3Hposition", "position"],

    // Erase sequences
    ["\x1b[2Jclear", "clear"],
    ["\x1b[Kclear line", "clear line"],
    ["\x1b[1Kclear line before", "clear line before"],
    ["\x1b[2Kclear entire line", "clear entire line"],

    // Combined sequences
    ["\x1b[1;31mbold red\x1b[0m", "bold red"],
    ["\x1b[1;4;31mbold underline red\x1b[0m", "bold underline red"],
    ["\x1b[31;42mred on green\x1b[0m", "red on green"],

    // Nested sequences
    ["\x1b[31mred \x1b[1mbold\x1b[22m red\x1b[39m", "red bold red"],
    ["\x1b[31m\x1b[32m\x1b[33myellow\x1b[39m", "yellow"],

    // OSC sequences
    ["\x1b]0;window title\x07text", "text"],
    ["\x1b]0;window title\x1b\\text", "text"],
    ["\x1b]8;;https://example.com\x07link\x1b]8;;\x07", "link"],

    // Other escape sequences
    ["\x1b(Btext", "text"],
    ["\x1b)Btext", "text"],
    ["\x1b*Btext", "text"],
    ["\x1b+Btext", "text"],
    ["\x1b=text", "text"],
    ["\x1b>text", "text"],
    ["\x1bDtext", "text"],
    ["\x1bEtext", "text"],
    ["\x1bHtext", "text"],
    ["\x1bMtext", "text"],
    ["\x1b7text", "text"],
    ["\x1b8text", "text"],
    ["\x1b#8text", "text"],
    ["\x1b%Gtext", "text"],

    // No ANSI codes
    ["plain text", "plain text"],
    ["", ""],
    ["hello world", "hello world"],

    // Partial sequences
    ["text\x1b", "text\x1b"],
    ["text\x1b[", "text\x1b["],
    ["text\x1b[3", "text\x1b[3"],

    // Real world examples
    ["\x1b[2K\x1b[1G\x1b[36m?\x1b[39m Installing...", "? Installing..."],
    ["\x1b[32m+ added\x1b[39m\n\x1b[31m- removed\x1b[39m", "+ added\n- removed"],
    ["\x1b[1A\x1b[2K\x1b[32m████████\x1b[39m 100%", "████████ 100%"],

    // Unicode handling
    ["\x1b[31m你好\x1b[39m", "你好"],
    ["\x1b[32m😀\x1b[39m", "😀"],
    ["\x1b[33m🚀 rocket\x1b[39m", "🚀 rocket"],

    // SGR parameters
    ["\x1b[0;1;31mtext\x1b[0m", "text"],
    ["\x1b[;;mtext", "text"],
    ["\x1b[1;;31mtext\x1b[m", "text"],

    // Reset sequences
    ["\x1b[0mtext", "text"],
    ["\x1b[mtext", "text"],
    ["text\x1b[0m", "text"],
    ["text\x1b[m", "text"],

    // Malformed sequences
    ["\x1b[31text", "ext"],
    ["\x1b[moretext", "oretext"],
    ["\x1b]incomplete", "ncomplete"],
    ["\x1b]", "\x1b]"],
    ["\x1b]i", ""],
    ["\x1b]in", "n"],
    ["\x1b]inc", "nc"],

    // Preserves whitespace
    ["\x1b[31m  text  \x1b[39m", "  text  "],
    ["\x1b[31m\ttext\t\x1b[39m", "\ttext\t"],
    ["\x1b[31m\ntext\n\x1b[39m", "\ntext\n"],

    // Edge cases
    ["\x1b[mtext", "text"],
    ["\x1b[0m\x1b[0m\x1b[0mtext", "text"],
    ["text\x1b[31m", "text"],
    ["\x1b[31m\x1b[32m\x1b[33m", ""],

    // OSC sequences (Operating System Commands)
    ["\x1b]0;title\x07text", "text"],
    ["\x1b]0;window title\x1b\\text", "text"],
    ["\x1b]2;title\x07", ""],
    ["\x1b]8;;https://example.com\x07link text\x1b]8;;\x07", "link text"],
    ["\x1b]8;;file:///path/to/file\x1b\\clickable\x1b]8;;\x1b\\", "clickable"],

    // C1 CSI sequences (using 0x9B instead of ESC[)
    ["\x9b31mtext\x9b39m", "text"],
    ["\x9b2Ktext", "text"],
    ["\x9b1Atext", "text"],

    // Complex CSI parameters
    ["\x1b[38;5;196mred text\x1b[0m", "red text"],
    ["\x1b[38;2;255;0;0mrgb red\x1b[0m", "rgb red"],
    ["\x1b[48;5;21mblue bg\x1b[0m", "blue bg"],
    ["\x1b[1;4;31mbold underline red\x1b[0m", "bold underline red"],

    // Cursor movement
    ["\x1b[10Atext", "text"],
    ["\x1b[5Btext", "text"],
    ["\x1b[20Ctext", "text"],
    ["\x1b[15Dtext", "text"],
    ["\x1b[2;5Htext", "text"],
    ["\x1b[Ktext", "text"],
    ["\x1b[2Jtext", "text"],

    // Save/restore cursor
    ["\x1b[stext\x1b[u", "text"],
    ["\x1b7text\x1b8", "text"],

    // Scroll sequences
    ["\x1b[5Stext", "text"],
    ["\x1b[3Ttext", "text"],

    // Alternative CSI final bytes
    ["\x1b[?25htext", "text"], // show cursor
    ["\x1b[?25ltext", "text"], // hide cursor
    ["\x1b[=3htext", "text"],
    ["\x1b[>5ctext", "text"],
    ["\x1b[<6~text", "text"],

    // Prefix characters in sequences
    ["\x1b[?1049htext", "text"],
    ["\x1b]#text", "ext"],
    ["\x1b[(text", "text"],
    ["\x1b[)text", "text"],
    ["\x1b[;text", "text"],

    // Multiple parameters with empty values
    ["\x1b[;5;mtext", "text"],
    ["\x1b[31;;39mtext", "text"],
    ["\x1b[;;;mtext", "text"],

    // Large parameter numbers (should be limited to 4 digits)
    ["\x1b[12345mtext", "5mtext"], // only first 4 digits consumed
    ["\x1b[1234mtext", "text"],
    ["\x1b[9999;1234mtext", "text"],

    // String terminator variations
    ["\x1b]0;title\x9ctext", "text"], // 0x9C terminator
    ["\x1b]2;test\x07more", "more"],

    // Mixed sequences
    ["\x1b[31m\x1b]0;title\x07\x1b[39mtext", "text"],
    ["\x1b]8;;\x07\x1b[4mlink\x1b[24m\x1b]8;;\x07", "link"],

    // Sequences at boundaries
    ["\x1b[31m", ""],
    ["\x1b[31mtext\x1b[39m\x1b[32m", "text"],
    ["start\x1b[31mtext\x1b[39mend", "starttextend"],

    // Invalid but should be partially consumed
    ["\x1b[31invalid", "invalid"], // 3 should be consumed as CSI final
    ["\x1b[9invalid", "invalid"], // 9 should be consumed as CSI final
    ["\x1b[Zinvalid", "invalid"], // Z should be consumed as CSI final

    // Very long parameter sequences
    ["\x1b[1;2;3;4;5;6;7;8;9;10;11;12mtext\x1b[0m", "text"],
    ["\x1b[" + "1;".repeat(100) + "mtext", "text"],

    // Nested-looking sequences (not actually nested)
    ["\x1b[31m\x1b in text\x1b[39m", " in text"],
    ["\x1b]0;\x1b[31mred\x1b[39m\x07text", "text"],

    // Control characters mixed with ANSI
    ["\x1b[31m\x08\x09\x0a\x0d\x1b[39m", "\x08\x09\x0a\x0d"],

    // Real terminal sequences
    ["\x1b[?1049h\x1b[22;0;0t\x1b[1;1H\x1b[2Jtext", "text"],
    ["\x1b[H\x1b[2J\x1b[3J", ""], // clear screen sequence
    ["\x1b[6n", ""], // cursor position query

    // Edge cases with C1 CSI (0x9B)
    ["\x9b31mtext\x9b39m", "text"],
    ["\x9b[31mtext", "[31mtext"], // 0x9B followed by [ is invalid
    ["\x9bHtext", "text"], // Cursor Home
    ["\x9b2Jtext", "text"], // Clear Screen

    // OSC sequences with various terminators
    ["\x1b]0;Window Title\x1b\\text", "text"], // ESC \ terminator
    ["\x1b]1;Icon Name\x07text", "text"], // BEL terminator
    ["\x1b]2;Both\x9ctext", "text"], // ST terminator
    ["\x1b]8;;http://example.com\x07", ""], // Hyperlink OSC

    // Invalid OSC sequences (missing terminator)
    ["\x1b]0;title", ""], // No terminator, consumes rest
    ["\x1b]2;test\x1bother", "other"], // Incomplete ESC terminator

    // Complex prefix combinations
    ["\x1b[[[31mtext", "text"],
    ["\x1b]]]]0;title\x07text", "text"],
    ["\x1b()()#;?31mtext", "text"],
    ["\x1b#?#?[31mtext", "text"],

    // CSI sequences with intermediate bytes
    ["\x1b[!ptext", "text"], // DECSTR
    ['\x1b["qtext', "text"], // DECSCA
    ["\x1b[$ptext", "text"], // DECRQM
    ["\x1b[%@text", "text"], // Select UTF-8

    // Private mode sequences
    ["\x1b[?25htext", "text"], // Show cursor
    ["\x1b[?25ltext", "text"], // Hide cursor
    ["\x1b[?1049htext", "text"], // Alternative screen buffer
    ["\x1b[?2004htext", "text"], // Bracketed paste mode

    // SGR (Select Graphic Rendition) variations
    ["\x1b[38;5;196mtext", "text"], // 256-color foreground
    ["\x1b[48;2;255;0;0mtext", "text"], // RGB background
    ["\x1b[38;2;0;255;0;48;5;17mtext", "text"], // Mixed RGB and 256-color

    // Function key sequences
    ["\x1b[11~text", "text"], // F1
    ["\x1b[24~text", "text"], // F12
    ["\x1b[1;5Ptext", "text"], // Ctrl+F1

    // Cursor movement sequences
    ["\x1b[10;20Htext", "text"], // Cursor position
    ["\x1b[5Atext", "text"], // Cursor up
    ["\x1b[3Btext", "text"], // Cursor down
    ["\x1b[2Ctext", "text"], // Cursor right
    ["\x1b[4Dtext", "text"], // Cursor left

    // Erase sequences
    ["\x1b[0Ktext", "text"], // Erase to end of line
    ["\x1b[1Ktext", "text"], // Erase to beginning of line
    ["\x1b[2Ktext", "text"], // Erase entire line
    ["\x1b[0Jtext", "text"], // Erase to end of screen
    ["\x1b[1Jtext", "text"], // Erase to beginning of screen
    ["\x1b[2Jtext", "text"], // Erase entire screen
    ["\x1b[3Jtext", "text"], // Erase scrollback buffer

    // Save/restore cursor
    ["\x1b[stext\x1b[u", "text"], // Save and restore cursor
    ["\x1b7text\x1b8", "text"], // Save and restore cursor (alternate)

    // Scroll sequences
    ["\x1b[5Stext", "text"], // Scroll up
    ["\x1b[3Ttext", "text"], // Scroll down
    ["\x1bMtext", "text"], // Reverse line feed
    ["\x1bDtext", "text"], // Line feed

    // Tab sequences
    ["\x1b[3gtext", "text"], // Clear tab stop
    ["\x1b[0gtext", "text"], // Clear tab stop at cursor
    ["\x1bHtext", "text"], // Set tab stop

    // Insert/delete sequences
    ["\x1b[5@text", "text"], // Insert characters
    ["\x1b[3Ptext", "text"], // Delete characters
    ["\x1b[2Ltext", "text"], // Insert lines
    ["\x1b[4Mtext", "text"], // Delete lines

    // Mode setting sequences
    ["\x1b[4htext", "text"], // Insert mode
    ["\x1b[4ltext", "text"], // Replace mode
    ["\x1b[20htext", "text"], // Automatic newline
    ["\x1b[20ltext", "text"], // Normal linefeed

    // Device status report
    ["\x1b[5ntext", "text"], // Device status report
    ["\x1b[6ntext", "text"], // Cursor position report
    ["\x1b[?15ntext", "text"], // Printer status report

    // Character sets
    ["\x1b(Atext", "text"], // UK character set
    ["\x1b)Btext", "text"], // US character set
    ["\x1b*0text", "text"], // DEC special character set
    ["\x1b+Btext", "text"], // G3 character set

    // Double-width/height sequences
    ["\x1b#3text", "text"], // Double-height line (top half)
    ["\x1b#4text", "text"], // Double-height line (bottom half)
    ["\x1b#5text", "text"], // Single-width line
    ["\x1b#6text", "text"], // Double-width line

    // Malformed sequences that should partially match
    ["\x1b[31", ""], // Incomplete CSI (no final byte)
    ["\x1b[31;", ""], // Incomplete parameters
    ["\x1b[31;4", ""], // Incomplete parameters
    ["\x1b]0;title", ""], // Incomplete OSC
    ["\x1b]0;title\x1b", ""], // Incomplete OSC terminator

    // Sequences with invalid parameters
    ["\x1b[99999mtext", "9mtext"], // Parameter too long (>4 digits)
    ["\x1b[;;;;;mtext", "text"], // Multiple empty parameters
    ["\x1b[1;2;3;4;5;6;7;8;9;10;11;12;13;14;15;16;17;18;19;20mtext", "text"], // Many parameters

    // Mixed valid and invalid sequences
    ["\x1b[31mred\x1binvalid\x1b[39mnormal", "redinvalidnormal"],
    ["\x1b]0;title\x07\x1binvalid\x1b[32mgreen", "invalidgreen"],

    // Unicode content in sequences
    ["\x1b]0;タイトル\x07text", "text"], // Japanese in OSC
    ["\x1b]2;🚀 rocket\x07text", "text"], // Emoji in OSC
    ["\x1b[31m🌈 rainbow\x1b[39m after", "🌈 rainbow after"],

    // Zero-width sequences
    ["\x1b[0mtext", "text"], // Reset all attributes
    ["\x1b[mtext", "text"], // Reset all attributes (no parameters)
    ["\x1b[;mtext", "text"], // Reset with empty parameter

    // Application keypad sequences
    ["\x1b=text", "text"], // Application keypad mode
    ["\x1b>text", "text"], // Numeric keypad mode

    // Bracketed paste sequences
    ["\x1b[200~pasted\x1b[201~text", "pastedtext"],

    // Focus events
    ["\x1b[Itext", "text"], // Focus in
    ["\x1b[Otext", "text"], // Focus out

    // Multiple sequences of varying lengths
    ["\x1b[31m\x1b[32m\x1b[33m\x1b[34m\x1b[35m\x1b[36m\x1b[37mtext", "text"], // 7 short sequences
    ["\x1b[38;5;196m\x1b[48;5;21m\x1b[1m\x1b[4mtext\x1b[0m", "text"], // Mixed length sequences
    ["\x1b[31mred\x1b[32mgreen\x1b[33myellow\x1b[34mblue\x1b[39mnormal", "redgreenyellowbluenormal"],

    // Long sequences (>16 characters)
    ["\x1b[38;2;255;128;64;48;5;196;1;4;9;7mtext", "text"], // Very long CSI with many parameters
    ["\x1b]0;This is a very long window title that exceeds 16 characters\x07text", "text"], // Long OSC
    ["\x1b]8;;https://very-long-domain-name.example.com/path/to/resource\x07link\x1b]8;;\x07", "link"], // Long URL in OSC
    ["\x1b[38;2;255;255;255;48;2;128;128;128;1;3;4;9mstyledtext\x1b[0m", "styledtext"], // RGB colors with attributes

    // Multiple long sequences
    [
      "\x1b]0;Window Title\x07\x1b[38;2;255;0;0;48;2;0;255;0mcolorful\x1b[0m\x1b]8;;https://example.com\x07link\x1b]8;;\x07",
      "colorfullink",
    ],
    ["\x1b[38;5;196;48;5;21;1;4;9mstyle1\x1b[38;5;46;48;5;201;22;24;29mstyle2\x1b[0m", "style1style2"],

    // Sequences with maximum parameter counts
    ["\x1b[1;2;3;4;5;6;7;8;9;10;11;12;13;14;15;16;17;18;19;20;21;22;23;24;25;26;27;28;29;30mtext", "text"],
    ["\x1b[255;255;255;255;255;255;255;255;255;255;255;255;255;255;255;255;255;255;255;255mtext", "text"],

    // Mixed short and long sequences in succession
    ["\x1b[31m\x1b[38;2;255;0;0;48;2;0;255;0;1;4;9m\x1b[32m\x1b[38;5;196;48;5;21;22;24mtext", "text"],
    ["\x1b[H\x1b[2J\x1b[38;2;255;255;255;48;2;0;0;0;1;3;4;7;9;53mstyledtext\x1b[0m\x1b[K", "styledtext"],

    // Long OSC sequences with various terminators
    ["\x1b]0;Title with special chars !@#$%^&*()_+-=[]{}|;:,.<>?\x07text", "text"],
    [
      "\x1b]8;;https://user:pass@subdomain.example.com:8080/path/to/resource?query=value#fragment\x07hyperlink\x1b]8;;\x07",
      "hyperlink",
    ],
    ["\x1b]2;Icon name with unicode: 🚀🌈⭐💎🎯\x1b\\text", "text"],

    // Sequences that span SIMD boundaries (assuming 16-byte chunks)
    ["\x1b[31m123456789012345\x1b[32mtext", "123456789012345text"], // Crosses 16-byte boundary
    ["12345678901234567\x1b[31mtext", "12345678901234567text"], // ANSI starts after 16 bytes
    ["123456789012345\x1b[38;2;255;0;0mtext", "123456789012345text"], // Long sequence after 15 chars

    // Multiple sequences with content between that crosses SIMD boundaries
    [
      "\x1b[31m12345678901234567890\x1b[32m12345678901234567890\x1b[33mtext",
      "123456789012345678901234567890123456789text",
    ],
    [
      "prefix\x1b[31m12345678901234567890\x1b[32mmiddle\x1b[33m12345678901234567890suffix",
      "prefix12345678901234567890middle12345678901234567890suffix",
    ],

    // Very long content with scattered sequences
    [
      "a".repeat(100) + "\x1b[31m" + "b".repeat(50) + "\x1b[32m" + "c".repeat(100),
      "a".repeat(100) + "b".repeat(50) + "c".repeat(100),
    ],
    ["\x1b[31m" + "x".repeat(200) + "\x1b[32m" + "y".repeat(200) + "\x1b[0m", "x".repeat(200) + "y".repeat(200)],

    // Complex mixed sequences with varying parameter lengths
    ["\x1b[1m\x1b[38;5;196m\x1b[48;2;255;255;255m\x1b[4;9;53mcomplex\x1b[22;24;29;49;39mtext", "complextext"],
    ["\x1b]0;\x07\x1b[31;32;33;34;35;36;37mcolors\x1b[0m\x1b]8;;\x07", "colors"],

    // Alternating short and long sequences
    ["\x1b[31m\x1b[38;2;255;0;0;48;2;0;255;0m\x1b[32m\x1b[38;5;196;48;5;21;1;4mtext", "text"],
    ["\x1b[H\x1b[38;2;255;255;255;48;2;0;0;0;1;3;4;7;9mstyle\x1b[K\x1b[38;5;46mmore\x1b[0m", "stylemore"],
  ];

  for (const [input, _] of testCases) {
    test(JSON.stringify(input), () => {
      const expected = stripAnsi(input);
      expect(Bun.stripAnsi(input)).toBe(expected);
    });
  }

  test("long strings", () => {
    const longText = "a".repeat(10000);
    const withAnsi = `\x1b[31m${longText}\x1b[39m`;
    expect(Bun.stripAnsi(withAnsi)).toBe(stripAnsi(withAnsi));
  });

  test("multiple sequences in long string", () => {
    const parts = [];
    for (let i = 0; i < 1000; i++) {
      parts.push(`\x1b[${30 + (i % 8)}mword${i}\x1b[39m`);
    }
    const input = parts.join(" ");
    expect(Bun.stripAnsi(input)).toBe(stripAnsi(input));
  });

  test("non-string input", () => {
    expect(Bun.stripAnsi(123 as any)).toBe("123");
    expect(Bun.stripAnsi(true as any)).toBe("true");
    expect(Bun.stripAnsi(false as any)).toBe("false");
    expect(Bun.stripAnsi(null as any)).toBe("null");
    expect(Bun.stripAnsi(undefined as any)).toBe("undefined");
  });
});
