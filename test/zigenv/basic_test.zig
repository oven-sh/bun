const std = @import("std");
const testing = std.testing;
const parser = @import("zigenv");

test "basic file parsing - ReadDotEnvFile" {
    const allocator = testing.allocator;

    const content =
        \\KEY1=value1
        \\KEY2=value2
        \\# comment
        \\KEY3=value3
    ;

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("value1", env.get("KEY1").?);
    try testing.expectEqualStrings("value2", env.get("KEY2").?);
    try testing.expectEqualStrings("value3", env.get("KEY3").?);
}

test "implicit double quote - ImplicitDoubleQuote" {
    const allocator = testing.allocator;

    const content = "KEY=  value with spaces  ";

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("value with spaces", env.get("KEY").?);
}
