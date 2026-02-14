const std = @import("std");
const testing = std.testing;
const parser = @import("zigenv");

test "double quotes - DoubleQuotes" {
    const allocator = testing.allocator;

    const content = "KEY=\"quoted value\"";

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("quoted value", env.get("KEY").?);
}

test "empty double quotes" {
    const allocator = testing.allocator;

    const content = "KEY=\"\"";

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("", env.get("KEY").?);
}

test "single quoted - SingleQuoted" {
    const allocator = testing.allocator;

    const content = "KEY='literal \\n ${var}'";

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    // In single quotes, \n is literal and ${var} is literal
    try testing.expectEqualStrings("literal \\n ${var}", env.get("KEY").?);
}

test "backtick mixed quotes" {
    const allocator = testing.allocator;

    const content = "KEY=`double \"quotes\" and single 'quotes' work inside backticks`";

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("double \"quotes\" and single 'quotes' work inside backticks", env.get("KEY").?);
}

test "backticks inside single quotes" {
    const allocator = testing.allocator;

    const content = "KEY='`backticks` work inside single quotes'";

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("`backticks` work inside single quotes", env.get("KEY").?);
}

test "backticks inside double quotes" {
    const allocator = testing.allocator;

    const content = "KEY=\"`backticks` work inside double quotes\"";

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("`backticks` work inside double quotes", env.get("KEY").?);
}

test "unquoted padding" {
    const allocator = testing.allocator;

    const content = "key=    some spaced out string    ";

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("some spaced out string", env.get("key").?);
}
