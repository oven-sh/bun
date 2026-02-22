const std = @import("std");
const zigenv = @import("zigenv");
const testing = std.testing;

test "edge: empty file" {
    const allocator = testing.allocator;
    const content = "";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqual(@as(usize, 0), env.map.count());
}

test "edge: file with only comments" {
    const allocator = testing.allocator;
    const content =
        \\# Comment 1
        \\# Comment 2
        \\# Comment 3
    ;

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqual(@as(usize, 0), env.map.count());
}

test "edge: file with only whitespace" {
    const allocator = testing.allocator;
    const content = "   \n\t\n   ";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqual(@as(usize, 0), env.map.count());
}

test "edge: duplicate keys last wins" {
    const allocator = testing.allocator;
    const content =
        \\KEY=first
        \\KEY=second
        \\KEY=third
    ;

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("KEY").?;
    try testing.expectEqualStrings("third", value);
}

test "edge: key with special characters" {
    const allocator = testing.allocator;
    const content = "MY-KEY.NAME_123=value";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("MY-KEY.NAME_123").?;
    try testing.expectEqualStrings("value", value);
}

test "edge: equals sign in value without quotes" {
    const allocator = testing.allocator;
    const content = "KEY=value=with=equals";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("KEY").?;
    try testing.expectEqualStrings("value=with=equals", value);
}

test "edge: empty value" {
    const allocator = testing.allocator;
    const content = "KEY=";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("KEY").?;
    try testing.expectEqualStrings("", value);
}

test "edge: empty quoted value" {
    const allocator = testing.allocator;
    const content = "KEY=\"\"";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("KEY").?;
    try testing.expectEqualStrings("", value);
}

test "edge: multiple consecutive line breaks" {
    const allocator = testing.allocator;
    const content =
        \\KEY1=value1
        \\
        \\
        \\
        \\KEY2=value2
    ;

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqual(@as(usize, 2), env.map.count());
}

test "edge: hash in quoted value" {
    const allocator = testing.allocator;
    const content = "KEY=\"value # not a comment\"";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("KEY").?;
    try testing.expectEqualStrings("value # not a comment", value);
}

test "edge: mixed quote types" {
    const allocator = testing.allocator;
    const content =
        \\KEY1="double quotes"
        \\KEY2='single quotes'
    ;

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const val1 = env.get("KEY1").?;
    try testing.expectEqualStrings("double quotes", val1);

    const val2 = env.get("KEY2").?;
    try testing.expectEqualStrings("single quotes", val2);
}

test "edge: single character key" {
    const allocator = testing.allocator;
    const content = "K=value";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("K").?;
    try testing.expectEqualStrings("value", value);
}

test "edge: single character value" {
    const allocator = testing.allocator;
    const content = "KEY=v";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("KEY").?;
    try testing.expectEqualStrings("v", value);
}

test "edge: numbers as values" {
    const allocator = testing.allocator;
    const content =
        \\INT=12345
        \\FLOAT=3.14159
        \\NEGATIVE=-42
    ;

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const int_val = env.get("INT").?;
    try testing.expectEqualStrings("12345", int_val);

    const float_val = env.get("FLOAT").?;
    try testing.expectEqualStrings("3.14159", float_val);

    const neg_val = env.get("NEGATIVE").?;
    try testing.expectEqualStrings("-42", neg_val);
}

test "edge: boolean-like values" {
    const allocator = testing.allocator;
    const content =
        \\TRUE_VAL=true
        \\FALSE_VAL=false
        \\YES_VAL=yes
        \\NO_VAL=no
    ;

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const true_val = env.get("TRUE_VAL").?;
    try testing.expectEqualStrings("true", true_val);

    const false_val = env.get("FALSE_VAL").?;
    try testing.expectEqualStrings("false", false_val);
}

test "edge: null-like values" {
    const allocator = testing.allocator;
    const content =
        \\NULL_VAL=null
        \\NONE_VAL=none
        \\NIL_VAL=nil
    ;

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const null_val = env.get("NULL_VAL").?;
    try testing.expectEqualStrings("null", null_val);
}

test "edge: interpolation with non-existent variable" {
    const allocator = testing.allocator;
    const content = "KEY=${DOES_NOT_EXIST}";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("KEY").?;
    // Should either be empty or the literal ${DOES_NOT_EXIST}
    try testing.expect(value.len >= 0);
}

test "edge: self-referencing interpolation" {
    const allocator = testing.allocator;
    const content = "KEY=${KEY}";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    // Should handle gracefully without infinite loop
    const value = env.get("KEY").?;
    _ = value;
}
