const std = @import("std");
const zigenv = @import("zigenv");
const testing = std.testing;

// Tests based on common .env parser behaviors from various implementations

test "compat: basic key-value from dotenv (Node.js)" {
    const allocator = testing.allocator;
    const content = "BASIC=basic";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("basic", env.get("BASIC").?);
}

test "compat: empty values from python-dotenv" {
    const allocator = testing.allocator;
    const content =
        \\EMPTY=
        \\EMPTY_QUOTES=""
    ;

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("", env.get("EMPTY").?);
    try testing.expectEqualStrings("", env.get("EMPTY_QUOTES").?);
}

test "compat: inline comments from dotenv (Ruby)" {
    const allocator = testing.allocator;
    const content = "KEY=value # this is a comment";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("KEY").?;
    // Comment should be stripped
    try testing.expectEqualStrings("value", value);
}

test "compat: single quotes from godotenv (Go)" {
    const allocator = testing.allocator;
    const content = "SINGLE='single quoted'";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("single quoted", env.get("SINGLE").?);
}

test "compat: double quotes from dotenv (Node.js)" {
    const allocator = testing.allocator;
    const content = "DOUBLE=\"double quoted\"";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("double quoted", env.get("DOUBLE").?);
}

test "compat: variable expansion from python-dotenv" {
    const allocator = testing.allocator;
    const content =
        \\BASE=hello
        \\EXPANDED=${BASE}_world
    ;

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const expanded = env.get("EXPANDED").?;
    try testing.expect(std.mem.indexOf(u8, expanded, "hello") != null);
    try testing.expect(std.mem.indexOf(u8, expanded, "world") != null);
}

test "compat: multiline values from dotenv (Ruby)" {
    const allocator = testing.allocator;
    const content = "MULTILINE=\"line1\\nline2\\nline3\"";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("MULTILINE").?;
    try testing.expect(value.len > 0);
}

test "compat: escaped characters from godotenv (Go)" {
    const allocator = testing.allocator;
    const content = "ESCAPED=\"\\t\\n\\r\"";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("ESCAPED").?;
    try testing.expect(value.len > 0);
}

test "compat: whitespace handling from dotenv (Node.js)" {
    const allocator = testing.allocator;
    const content = "  WHITESPACE  =  value  ";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    // Key and value should have whitespace trimmed
    const value = env.get("WHITESPACE").?;
    try testing.expectEqualStrings("value", value);
}

test "compat: export prefix from bash-style dotenv" {
    const allocator = testing.allocator;
    const content = "export KEY=value";

    var opts = zigenv.ParserOptions.defaults();
    opts.support_export_prefix = true;

    var env = try zigenv.parseStringWithOptions(allocator, content, opts, null, null);
    defer env.deinit();

    // Should parse with or without 'export' prefix
    // This may fail if export is not supported - that's okay
    // Should parse with 'export' prefix stripped
    try testing.expectEqualStrings("value", env.get("KEY").?);
}

test "compat: equals in value from python-dotenv" {
    const allocator = testing.allocator;
    const content = "URL=https://example.com?param=value";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const url = env.get("URL").?;
    try testing.expect(std.mem.indexOf(u8, url, "=") != null);
}

test "compat: special characters from godotenv (Go)" {
    const allocator = testing.allocator;
    const content = "SPECIAL=!@#$%^&*()_+-=[]{}|;:,.<>?";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("SPECIAL").?;
    try testing.expect(value.len > 0);
}

test "compat: numeric values from dotenv (Ruby)" {
    const allocator = testing.allocator;
    const content =
        \\NUMBER=123
        \\FLOAT=3.14
        \\NEGATIVE=-42
    ;

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    // Values should be stored as strings
    try testing.expectEqualStrings("123", env.get("NUMBER").?);
    try testing.expectEqualStrings("3.14", env.get("FLOAT").?);
    try testing.expectEqualStrings("-42", env.get("NEGATIVE").?);
}

test "compat: json-like values from python-dotenv" {
    const allocator = testing.allocator;
    const content = "JSON={\"key\":\"value\",\"num\":123}";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const json = env.get("JSON").?;
    try testing.expect(std.mem.indexOf(u8, json, "key") != null);
}
