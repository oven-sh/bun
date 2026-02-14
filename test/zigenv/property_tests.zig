const std = @import("std");
const zigenv = @import("zigenv");
const testing = std.testing;

test "property: key count matches pairs parsed" {
    const allocator = testing.allocator;
    const content =
        \\KEY1=value1
        \\KEY2=value2
        \\KEY3=value3
    ;

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    //Should have exactly 3 unique keys
    try testing.expectEqual(@as(usize, 3), env.map.count());
}

test "property: all keys are accessible" {
    const allocator = testing.allocator;
    const content =
        \\A=1
        \\B=2
        \\C=3
        \\D=4
    ;

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    // Every key should be retrievable
    try testing.expect(env.get("A") != null);
    try testing.expect(env.get("B") != null);
    try testing.expect(env.get("C") != null);
    try testing.expect(env.get("D") != null);
}

test "property: interpolation is idempotent" {
    const allocator = testing.allocator;
    const content =
        \\BASE=value
        \\DERIVED=${BASE}
    ;

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    // Getting the same value multiple times should return same result
    const first = env.get("DERIVED").?;
    const second = env.get("DERIVED").?;
    const third = env.get("DERIVED").?;

    try testing.expectEqualStrings(first, second);
    try testing.expectEqualStrings(second, third);
}

test "property: comments are always ignored" {
    const allocator = testing.allocator;
    const content =
        \\# This is a comment
        \\KEY=value # inline comment
        \\# Another comment
    ;

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    // Only non-comment lines create pairs
    try testing.expectEqual(@as(usize, 1), env.map.count());

    const value = env.get("KEY").?;
    // Value should not contain comment
    try testing.expect(std.mem.indexOf(u8, value, "#") == null);
}

test "property: empty values are distinct from missing keys" {
    const allocator = testing.allocator;
    const content = "EMPTY=";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    // Empty value exists
    const empty_value = env.get("EMPTY");
    try testing.expect(empty_value != null);
    try testing.expectEqualStrings("", empty_value.?);

    // Missing key doesn't exist
    const missing = env.get("MISSING");
    try testing.expect(missing == null);
}

test "property: parsing is order independent for non-dependent values" {
    const allocator = testing.allocator;

    const content1 =
        \\A=1
        \\B=2
    ;
    const content2 =
        \\B=2
        \\A=1
    ;

    var env1 = try zigenv.parseString(allocator, content1);
    defer env1.deinit();

    var env2 = try zigenv.parseString(allocator, content2);
    defer env2.deinit();

    // Both should have same values regardless of order
    try testing.expectEqualStrings(env1.get("A").?, env2.get("A").?);
    try testing.expectEqualStrings(env1.get("B").?, env2.get("B").?);
}

test "property: quoted and unquoted same content are equal" {
    const allocator = testing.allocator;

    const content1 = "KEY=hello";
    const content2 = "KEY=\"hello\"";
    const content3 = "KEY='hello'";

    var env1 = try zigenv.parseString(allocator, content1);
    defer env1.deinit();

    var env2 = try zigenv.parseString(allocator, content2);
    defer env2.deinit();

    var env3 = try zigenv.parseString(allocator, content3);
    defer env3.deinit();

    // All three should yield the same value
    try testing.expectEqualStrings(env1.get("KEY").?, env2.get("KEY").?);
    try testing.expectEqualStrings(env2.get("KEY").?, env3.get("KEY").?);
}

test "property: whitespace normalization in unquoted values" {
    const allocator = testing.allocator;
    const content = "KEY=  value  ";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("KEY").?;
    // Leading/trailing whitespace should be trimmed
    try testing.expectEqualStrings("value", value);
}

test "property: duplicate keys follow last-wins semantics" {
    const allocator = testing.allocator;
    const content =
        \\KEY=first
        \\KEY=second
        \\KEY=third
    ;

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    // Should always get the last value
    const value = env.get("KEY").?;
    try testing.expectEqualStrings("third", value);

    // Should only have one KEY entry
    try testing.expectEqual(@as(usize, 1), env.map.count());
}

test "property: line endings are normalized" {
    const allocator = testing.allocator;

    const content_lf = "KEY=value\n";
    const content_crlf = "KEY=value\r\n";
    const content_cr = "KEY=value\r";

    var env_lf = try zigenv.parseString(allocator, content_lf);
    defer env_lf.deinit();

    var env_crlf = try zigenv.parseString(allocator, content_crlf);
    defer env_crlf.deinit();

    var env_cr = try zigenv.parseString(allocator, content_cr);
    defer env_cr.deinit();

    // All should parse to the same value
    try testing.expectEqualStrings(env_lf.get("KEY").?, env_crlf.get("KEY").?);
    try testing.expectEqualStrings(env_crlf.get("KEY").?, env_cr.get("KEY").?);
}
