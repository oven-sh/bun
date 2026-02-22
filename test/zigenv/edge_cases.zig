const std = @import("std");
const testing = std.testing;
const parser = @import("zigenv");

test "empty values" {
    const allocator = testing.allocator;

    const content =
        \\EMPTY_UNQUOTED=
        \\EMPTY_SINGLE=''
        \\EMPTY_DOUBLE=""
    ;

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("", env.get("EMPTY_UNQUOTED").?);
    try testing.expectEqualStrings("", env.get("EMPTY_SINGLE").?);
    try testing.expectEqualStrings("", env.get("EMPTY_DOUBLE").?);
}

test "windows line endings" {
    const allocator = testing.allocator;

    // Use raw string with \r\n
    const content = "KEY1=value1\r\nKEY2=value2\r\n";

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("value1", env.get("KEY1").?);
    try testing.expectEqualStrings("value2", env.get("KEY2").?);
}

test "mixed line endings" {
    const allocator = testing.allocator;

    const content = "KEY1=value1\nKEY2=value2\r\nKEY3=value3\n";

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("value1", env.get("KEY1").?);
    try testing.expectEqualStrings("value2", env.get("KEY2").?);
    try testing.expectEqualStrings("value3", env.get("KEY3").?);
}
