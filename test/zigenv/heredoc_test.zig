const std = @import("std");
const testing = std.testing;
const parser = @import("zigenv");

test "triple single quoted with garbage - TripleSingleQuotedWithMoreGarbage" {
    const allocator = testing.allocator;

    const content =
        \\KEY='''multi
        \\line
        \\value'''garbage here is ignored
    ;

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("multi\nline\nvalue", env.get("KEY").?);
}

test "double quoted heredoc with escapes - DoubleQuotedHereDoc" {
    const allocator = testing.allocator;

    const content =
        \\KEY="""line1\nline2"""
    ;

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("line1\nline2", env.get("KEY").?);
}

test "double quoted heredoc with interpolation - DoubleQuotedHereDoc2" {
    const allocator = testing.allocator;

    const content =
        \\VAR=test
        \\KEY="""Value: ${VAR}"""
    ;

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("Value: test", env.get("KEY").?);
}

test "double quoted heredoc with multiple interpolations" {
    const allocator = testing.allocator;

    const content =
        \\A=1
        \\B=2
        \\KEY="""
        \\A: ${A}
        \\B: ${B}
        \\"""
    ;

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("\nA: 1\nB: 2\n", env.get("KEY").?);
}
