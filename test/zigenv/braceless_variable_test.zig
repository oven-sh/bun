const std = @import("std");
const testing = std.testing;
const zigenv = @import("zigenv");
const allocator = testing.allocator;

test "braceless variable basic" {
    const content =
        \\BASE=hello
        \\RESULT=$BASE world
    ;
    // We need to access parseStringWithOptions from zigenv which is the module
    var env = try zigenv.parseStringWithOptions(allocator, content, .{ .allow_braceless_variables = true }, null, null);
    defer env.deinit();

    try testing.expectEqualStrings("hello world", env.get("RESULT").?);
}

test "braceless variable at end of value" {
    const content =
        \\BASE=hello
        \\RESULT=say $BASE
    ;
    var env = try zigenv.parseStringWithOptions(allocator, content, .{ .allow_braceless_variables = true }, null, null);
    defer env.deinit();

    try testing.expectEqualStrings("say hello", env.get("RESULT").?);
}

test "mixed brace and braceless" {
    const content =
        \\A=1
        \\B=2
        \\RESULT=$A and ${B}
    ;
    var env = try zigenv.parseStringWithOptions(allocator, content, .{ .allow_braceless_variables = true }, null, null);
    defer env.deinit();

    try testing.expectEqualStrings("1 and 2", env.get("RESULT").?);
}

test "braceless variable with special chars" {
    const content =
        \\PATH=/usr/bin
        \\FULL=$PATH:/local/bin
    ;
    var env = try zigenv.parseStringWithOptions(allocator, content, .{ .allow_braceless_variables = true }, null, null);
    defer env.deinit();

    try testing.expectEqualStrings("/usr/bin:/local/bin", env.get("FULL").?);
}

test "option disabled ignores $VAR" {
    const content =
        \\RESULT=$VAR literal
    ;
    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    // Without option, $VAR is treated literally
    try testing.expectEqualStrings("$VAR literal", env.get("RESULT").?);
}

test "braceless variable in double quotes" {
    const content =
        \\VAR=value
        \\QUOTED="The value is $VAR."
    ;
    var env = try zigenv.parseStringWithOptions(allocator, content, .{ .allow_braceless_variables = true }, null, null);
    defer env.deinit();

    try testing.expectEqualStrings("The value is value.", env.get("QUOTED").?);
}

test "braceless variable in single quotes ignored" {
    const content =
        \\VAR=value
        \\SINGLE='The value is $VAR'
    ;
    var env = try zigenv.parseStringWithOptions(allocator, content, .{ .allow_braceless_variables = true }, null, null);
    defer env.deinit();

    try testing.expectEqualStrings("The value is $VAR", env.get("SINGLE").?);
}

test "braceless variable with escape" {
    const content =
        \\VAR=value
        \\ESCAPED=\$VAR
    ;
    var env = try zigenv.parseStringWithOptions(allocator, content, .{ .allow_braceless_variables = true }, null, null);
    defer env.deinit();

    // The logic should treat \$ as literal $ and suppress variable expansion
    try testing.expectEqualStrings("$VAR", env.get("ESCAPED").?);
}

test "braceless variable with double dollar" {
    // Handling edge case $$VAR
    const content =
        \\VAR=value
        \\DOUBLE=$$VAR
    ;
    var env = try zigenv.parseStringWithOptions(allocator, content, .{ .allow_braceless_variables = true }, null, null);
    defer env.deinit();

    // First $ is literal. Second $ starts variable.
    // Result should be $value.
    try testing.expectEqualStrings("$value", env.get("DOUBLE").?);
}

test "braceless variable invalid start char" {
    const content =
        \\VAR=value
        \\INVALID=$123
    ;
    var env = try zigenv.parseStringWithOptions(allocator, content, .{ .allow_braceless_variables = true }, null, null);
    defer env.deinit();

    try testing.expectEqualStrings("$123", env.get("INVALID").?);
}

test "braceless variable underscore" {
    const content =
        \\_VAR=underscore
        \\RESULT=$_VAR
    ;
    var env = try zigenv.parseStringWithOptions(allocator, content, .{ .allow_braceless_variables = true }, null, null);
    defer env.deinit();

    try testing.expectEqualStrings("underscore", env.get("RESULT").?);
}
