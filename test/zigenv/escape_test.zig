const std = @import("std");
const testing = std.testing;
const parser = @import("zigenv");

test "control codes - ControlCodes" {
    const allocator = testing.allocator;

    // KEY="line1\nline2\ttab"
    const content = "KEY=\"line1\\nline2\\ttab\"";

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("line1\nline2\ttab", env.get("KEY").?);
}

test "all control characters" {
    const allocator = testing.allocator;

    const content = "KEY=\"\\n\\t\\r\\b\\f\\v\\a\\\"\\'\\\\\"";

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    const expected = "\n\t\r\x08\x0C\x0B\x07\"\'\\";
    try testing.expectEqualStrings(expected, env.get("KEY").?);
}

test "ControlCodes Parity" {
    const allocator = testing.allocator;

    const content =
        \\a=\tb\n
        \\b=\\\\
        \\c=\\\\t
        \\d="\\\\\t"
        \\e=" \\ \\ \ \\ \\\\t"
        \\f=" \\ \\ \b \\ \\\\t"
        \\g=" \\ \\ \r \\ \\\\b\n"
    ;

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("\tb\n", env.get("a").?);
    try testing.expectEqualStrings("\\\\", env.get("b").?);
    try testing.expectEqualStrings("\\\\t", env.get("c").?);
    try testing.expectEqualStrings("\\\\\t", env.get("d").?);
    try testing.expectEqualStrings(" \\ \\ \\ \\ \\\\t", env.get("e").?);
    try testing.expectEqualStrings(" \\ \\ \x08 \\ \\\\t", env.get("f").?);
    try testing.expectEqualStrings(" \\ \\ \r \\ \\\\b\n", env.get("g").?);
}
