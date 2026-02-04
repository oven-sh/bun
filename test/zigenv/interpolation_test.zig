const std = @import("std");
const testing = std.testing;
const parser = @import("zigenv");

test "basic interpolation - InterpolateValues" {
    const allocator = testing.allocator;

    const content =
        \\NAME=Alice
        \\GREETING=Hello ${NAME}
    ;

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("Alice", env.get("NAME").?);
    try testing.expectEqualStrings("Hello Alice", env.get("GREETING").?);
}

test "multiple interpolations - InterpolateValues" {
    const allocator = testing.allocator;

    const content =
        \\FIRST=John
        \\LAST=Doe
        \\FULL=${FIRST} ${LAST}
    ;

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("John Doe", env.get("FULL").?);
}

test "chained interpolation - InterpolateValuesAdvanced" {
    const allocator = testing.allocator;

    const content =
        \\A=x
        \\B=${A}
        \\C=${B}
    ;

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("x", env.get("A").?);
    try testing.expectEqualStrings("x", env.get("B").?);
    try testing.expectEqualStrings("x", env.get("C").?);
}

test "order independence - InterpolateValuesAdvanced" {
    const allocator = testing.allocator;

    const content =
        \\C=${B}
        \\B=${A}
        \\A=x
    ;

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("x", env.get("A").?);
    try testing.expectEqualStrings("x", env.get("B").?);
    try testing.expectEqualStrings("x", env.get("C").?);
}

test "direct circular dependency - InterpolateValuesCircular" {
    const allocator = testing.allocator;

    const content =
        \\A=${A}
    ;

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("${A}", env.get("A").?);
}

test "indirect circular dependency - InterpolateValuesCircular" {
    const allocator = testing.allocator;

    const content =
        \\A=${B}
        \\B=${A}
    ;

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("${B}", env.get("A").?);
    try testing.expectEqualStrings("${A}", env.get("B").?);
}

test "escaped dollar sign - InterpolateValuesEscaped" {
    const allocator = testing.allocator;

    const content = "KEY=\\${VAR}";

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("${VAR}", env.get("KEY").?);
}

test "unclosed brace - InterpolateUnClosed" {
    const allocator = testing.allocator;

    const content = "KEY=${UNCLOSED";

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("${UNCLOSED", env.get("KEY").?);
}

test "whitespace trimming in interpolation" {
    const allocator = testing.allocator;

    const content =
        \\VAR=value
        \\KEY=${ VAR }
    ;

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("value", env.get("KEY").?);
}
