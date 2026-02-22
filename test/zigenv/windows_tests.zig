const std = @import("std");
const zigenv = @import("zigenv");
const testing = std.testing;

test "windows: CRLF line endings" {
    const allocator = testing.allocator;
    const content = "KEY=value\r\nOTHER=data\r\n";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const val1 = env.get("KEY").?;
    try testing.expectEqualStrings("value", val1);

    const val2 = env.get("OTHER").?;
    try testing.expectEqualStrings("data", val2);
}

test "windows: mixed CRLF and LF" {
    const allocator = testing.allocator;
    const content = "KEY=value\r\nOTHER=data\nTHIRD=more\r\n";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqual(@as(usize, 3), env.map.count());
}

test "windows: file paths with backslashes" {
    const allocator = testing.allocator;
    const content = "PATH=C:\\Users\\Admin\\file.txt";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("PATH").?;
    try testing.expect(std.mem.indexOf(u8, value, "C:") != null);
    try testing.expect(std.mem.indexOf(u8, value, "Users") != null);
}

test "windows: UNC paths" {
    const allocator = testing.allocator;
    const content = "SHARE=\\\\server\\share\\folder";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("SHARE").?;
    try testing.expect(std.mem.indexOf(u8, value, "server") != null);
}

test "windows: quoted paths with backslashes" {
    const allocator = testing.allocator;
    const content = "PATH=\"C:\\\\Program Files\\\\MyApp\\\\bin\"";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("PATH").?;
    try testing.expect(std.mem.indexOf(u8, value, "Program Files") != null);
}

test "windows: multiple paths in PATH variable" {
    const allocator = testing.allocator;
    const content = "PATH=C:\\Windows;C:\\Windows\\System32;C:\\Program Files";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("PATH").?;
    try testing.expect(std.mem.indexOf(u8, value, ";") != null);
    try testing.expect(std.mem.indexOf(u8, value, "Windows") != null);
}

test "windows: drive letters" {
    const allocator = testing.allocator;
    const content =
        \\C_DRIVE=C:\
        \\D_DRIVE=D:\
        \\E_DRIVE=E:\
    ;

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    _ = env.get("C_DRIVE").?;
    _ = env.get("D_DRIVE").?;
    _ = env.get("E_DRIVE").?;
}

test "windows: case sensitivity in keys" {
    const allocator = testing.allocator;
    const content =
        \\Path=first
        \\PATH=second
    ;

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    // Keys should be case-sensitive
    const path_lower = env.get("Path").?;
    const path_upper = env.get("PATH").?;

    try testing.expect(!std.mem.eql(u8, path_lower, path_upper));
}

test "windows: CR only line endings" {
    const allocator = testing.allocator;
    const content = "KEY=value\rOTHER=data\r";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    // Should handle CR-only line endings
    try testing.expect(env.map.count() > 0);
}

test "windows: CRLF in heredoc" {
    const allocator = testing.allocator;
    const content = "KEY=\"\"\"\r\nline1\r\nline2\r\nline3\r\n\"\"\"";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("KEY").?;
    try testing.expect(std.mem.indexOf(u8, value, "line1") != null);
    try testing.expect(std.mem.indexOf(u8, value, "line2") != null);
}
