const std = @import("std");
const testing = std.testing;
const parser = @import("zigenv");

// Port of C++ InterpolateValues test - tests whitespace handling in ${var} syntax
test "whitespace in interpolation - all variations from C++" {
    const allocator = testing.allocator;

    const content =
        \\a1=bc
        \\b2=${a1}
        \\b3=$ {a1}
        \\b4=$ {a1 }
        \\b5=$ { a1 }
        \\b6=$ { a1}
    ;

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    // All variations should resolve to "bc"
    try testing.expectEqualStrings("bc", env.get("a1").?);
    try testing.expectEqualStrings("bc", env.get("b2").?); // Normal ${a1}
    try testing.expectEqualStrings("bc", env.get("b3").?); // Space after $
    try testing.expectEqualStrings("bc", env.get("b4").?); // Space after $ and before }
    try testing.expectEqualStrings("bc", env.get("b5").?); // Spaces around var name
    try testing.expectEqualStrings("bc", env.get("b6").?); // Space after {
}

// Additional advanced whitespace interpolation cases
test "whitespace interpolation - advanced from C++" {
    const allocator = testing.allocator;

    const content =
        \\a1=bc
        \\b2=${a1}
        \\b3=$ {b5}
        \\b4=$ {a1 }
        \\b5=$ { a1 } ${b2}
        \\b6=$ { b2}
    ;

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("bc", env.get("a1").?);
    try testing.expectEqualStrings("bc", env.get("b2").?);
    try testing.expectEqualStrings("bc bc", env.get("b3").?); // Forward reference
    try testing.expectEqualStrings("bc", env.get("b4").?);
    try testing.expectEqualStrings("bc bc", env.get("b5").?); // Multiple interpolations
    try testing.expectEqualStrings("bc", env.get("b6").?);
}

// Test circular dependency with whitespace variations
test "circular dependency with whitespace - from C++" {
    const allocator = testing.allocator;

    const content =
        \\a1=bc
        \\b2=${a1}
        \\b3=hello ${b4} hello
        \\b4=$ { b3}
    ;

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("bc", env.get("a1").?);
    try testing.expectEqualStrings("bc", env.get("b2").?);
    try testing.expectEqualStrings("hello ${b4} hello", env.get("b3").?); // Circular - not resolved
    try testing.expectEqualStrings("$ { b3}", env.get("b4").?); // Circular - not resolved
}

// Test escaped interpolation with whitespace
test "escaped interpolation with whitespace - from C++" {
    const allocator = testing.allocator;

    const content =
        \\a1=bc
        \\b2=${a1}
        \\b3=$ {a1\\}
        \\b4=\\$ {a1 }
        \\b5=$ \\{ a1 }
        \\b6=\\$ { a1}
    ;

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("bc", env.get("a1").?);
    try testing.expectEqualStrings("bc", env.get("b2").?);
    try testing.expectEqualStrings("$ {a1\\}", env.get("b3").?); // Escaped closing brace
    try testing.expectEqualStrings("\\$ {a1 }", env.get("b4").?); // Escaped $
    try testing.expectEqualStrings("$ \\{ a1 }", env.get("b5").?); // Escaped {
    try testing.expectEqualStrings("\\$ { a1}", env.get("b6").?); // Escaped $
}

// Test heredoc with whitespace in interpolation
test "heredoc with whitespace interpolation - from C++" {
    const allocator = testing.allocator;

    const content =
        \\a="""
        \\heredoc
        \\"""
        \\b=${a}
        \\c=""" $ {b }
    ;

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("\nheredoc\n", env.get("a").?);
    try testing.expectEqualStrings("\nheredoc\n", env.get("b").?);
    // c has unclosed heredoc, should handle gracefully
    const c_val = env.get("c");
    try testing.expect(c_val != null);
}
