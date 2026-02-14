const std = @import("std");
const testing = std.testing;
const parser = @import("zigenv");
const ParserOptions = parser.ParserOptions;

// Tests for single-quote heredocs when option is ENABLED

test "single quote heredoc - basic" {
    const allocator = testing.allocator;

    const content =
        \\KEY='this is a heredoc
        \\as well'
    ;

    var env = try parser.parseStringWithOptions(allocator, content, .{
        .allow_single_quote_heredocs = true,
    }, null, null);
    defer env.deinit();

    try testing.expectEqualStrings("this is a heredoc\nas well", env.get("KEY").?);
}

test "single quote heredoc - multiple lines" {
    const allocator = testing.allocator;

    const content =
        \\KEY='line 1
        \\line 2
        \\line 3'
    ;

    var env = try parser.parseStringWithOptions(allocator, content, .{
        .allow_single_quote_heredocs = true,
    }, null, null);
    defer env.deinit();

    try testing.expectEqualStrings("line 1\nline 2\nline 3", env.get("KEY").?);
}

test "single quote heredoc - preserves literal backslash" {
    const allocator = testing.allocator;

    // Single quotes preserve backslashes literally
    const content =
        \\KEY='literal \n
        \\still literal'
    ;

    var env = try parser.parseStringWithOptions(allocator, content, .{
        .allow_single_quote_heredocs = true,
    }, null, null);
    defer env.deinit();

    // In single quotes, \n is literal backslash-n, not a newline escape
    try testing.expectEqualStrings("literal \\n\nstill literal", env.get("KEY").?);
}

test "single quote heredoc - preserves dollar signs" {
    const allocator = testing.allocator;

    const content =
        \\VAR=value
        \\KEY='literal ${VAR}
        \\no interpolation'
    ;

    var env = try parser.parseStringWithOptions(allocator, content, .{
        .allow_single_quote_heredocs = true,
    }, null, null);
    defer env.deinit();

    // In single quotes, ${VAR} is literal, no interpolation
    try testing.expectEqualStrings("literal ${VAR}\nno interpolation", env.get("KEY").?);
}

test "double quote heredoc - basic" {
    const allocator = testing.allocator;

    const content =
        \\KEY="this
        \\is a heredoc"
    ;

    // Double quotes already allow newlines by default
    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("this\nis a heredoc", env.get("KEY").?);
}

test "double quote heredoc - with interpolation" {
    const allocator = testing.allocator;

    const content =
        \\VAR=test
        \\KEY="Value:
        \\${VAR}"
    ;

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("Value:\ntest", env.get("KEY").?);
}

// Tests for backward compatibility (option DISABLED)

test "option disabled - single quote terminates on newline" {
    const allocator = testing.allocator;

    // Without the option, single quotes should terminate on newline
    const content =
        \\KEY='this
        \\OTHER=value
    ;

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    // Should parse as two separate pairs (old behavior)
    // KEY should be "this" (truncated at newline)
    // OTHER should be "value"
    try testing.expect(env.get("OTHER") != null);
    try testing.expectEqualStrings("value", env.get("OTHER").?);
}

test "option disabled - backwards compatibility preserved" {
    const allocator = testing.allocator;

    // Standard single-line single quotes still work
    const content = "KEY='simple value'";

    var env = try parser.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("simple value", env.get("KEY").?);
}

// Tests for mixed quote styles

test "mixed - single quote heredoc followed by other pairs" {
    const allocator = testing.allocator;

    const content =
        \\MULTI='line 1
        \\line 2'
        \\SIMPLE=value
    ;

    var env = try parser.parseStringWithOptions(allocator, content, .{
        .allow_single_quote_heredocs = true,
    }, null, null);
    defer env.deinit();

    try testing.expectEqualStrings("line 1\nline 2", env.get("MULTI").?);
    try testing.expectEqualStrings("value", env.get("SIMPLE").?);
}

test "mixed - double and single quote heredocs" {
    const allocator = testing.allocator;

    const content =
        \\DOUBLE="double
        \\heredoc"
        \\SINGLE='single
        \\heredoc'
    ;

    var env = try parser.parseStringWithOptions(allocator, content, .{
        .allow_single_quote_heredocs = true,
    }, null, null);
    defer env.deinit();

    try testing.expectEqualStrings("double\nheredoc", env.get("DOUBLE").?);
    try testing.expectEqualStrings("single\nheredoc", env.get("SINGLE").?);
}

// Test ParserOptions convenience methods

test "ParserOptions.defaults() preserves backward compat" {
    const opts = ParserOptions.defaults();
    try testing.expect(!opts.allow_single_quote_heredocs);
    try testing.expect(opts.allow_double_quote_heredocs);
}

test "ParserOptions.bashCompatible() enables all heredocs" {
    const opts = ParserOptions.bashCompatible();
    try testing.expect(opts.allow_single_quote_heredocs);
    try testing.expect(opts.allow_double_quote_heredocs);
}

test "single quote heredoc with bashCompatible options" {
    const allocator = testing.allocator;

    const content =
        \\KEY='bash style
        \\multi-line'
    ;

    var env = try parser.parseStringWithOptions(allocator, content, ParserOptions.bashCompatible(), null, null);
    defer env.deinit();

    try testing.expectEqualStrings("bash style\nmulti-line", env.get("KEY").?);
}
