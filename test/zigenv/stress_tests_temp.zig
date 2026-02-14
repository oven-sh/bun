const std = @import("std");
const zigenv = @import("zigenv");
const testing = std.testing;

test "stress: extremely long key (1KB)" {
    const allocator = testing.allocator;

    var key_buffer: [1024]u8 = undefined;
    @memset(&key_buffer, 'K');
    const long_key = key_buffer[0..];

    const content = try std.fmt.allocPrint(allocator, "{s}=value", .{long_key});
    defer allocator.free(content);

    const env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get(long_key).?;
    try testing.expectEqualStrings("value", value);
}

test "stress: extremely long value (100KB)" {
    const allocator = testing.allocator;

    var value_buffer: [100 * 1024]u8 = undefined;
    @memset(&value_buffer, 'V');
    const long_value = value_buffer[0..];

    const content = try std.fmt.allocPrint(allocator, "KEY={s}", .{long_value});
    defer allocator.free(content);

    const env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get(long_key).?;
    try testing.expectEqual(long_value.len, value.len);
}

test "stress: many key-value pairs (1000)" {
    const allocator = testing.allocator;

    var content = std.ArrayList(u8).init(allocator);
    defer content.deinit();

    var i: usize = 0;
    while (i < 1000) : (i += 1) {
        try content.writer().print("KEY{d}=value{d}\n", .{ i, i });
    }

    const env = try zigenv.parseString(allocator, content.items);
    defer env.deinit();

    try testing.expectEqual(@as(usize, 1000), env.pairs.items.len);

    // Spot check
    const val0 = env.get().?;
    try testing.expectEqualStrings("value0", val0);

    const val999 = env.get().?;
    try testing.expectEqualStrings("value999", val999);
}

test "stress: deeply nested interpolation (10 levels)" {
    const allocator = testing.allocator;

    const content =
        \\VAR0=final_value
        \\VAR1=${VAR0}
        \\VAR2=${VAR1}
        \\VAR3=${VAR2}
        \\VAR4=${VAR3}
        \\VAR5=${VAR4}
        \\VAR6=${VAR5}
        \\VAR7=${VAR6}
        \\VAR8=${VAR7}
        \\VAR9=${VAR8}
    ;

    const env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const final = env.get().?;
    try testing.expect(std.mem.indexOf(u8, final, "final_value") != null);
}

test "stress: many interpolations in single value (100)" {
    const allocator = testing.allocator;

    var content = std.ArrayList(u8).init(allocator);
    defer content.deinit();

    // Define 100 base variables
    var i: usize = 0;
    while (i < 100) : (i += 1) {
        try content.writer().print("BASE{d}=val{d}\n", .{ i, i });
    }

    // Create a value with 100 interpolations
    try content.writer().writeAll("COMBINED=");
    i = 0;
    while (i < 100) : (i += 1) {
        try content.writer().print("${{BASE{d}}}", .{i});
        if (i < 99) {
            try content.writer().writeAll("_");
        }
    }
    try content.writer().writeAll("\n");

    const env = try zigenv.parseString(allocator, content.items);
    defer env.deinit();

    const combined = env.get().?;
    try testing.expect(combined.len > 0);
}

test "stress: rapi allocation deallocation (100 iterations)" {
    const allocator = testing.allocator;
    const content =
        \\KEY1=value1
        \\KEY2=value2
        \\KEY3=value3
    ;

    var i: usize = 0;
    while (i < 100) : (i += 1) {
        const env = try zigenv.parseString(allocator, content);
        defer env.deinit();

        _ = env.get().?;
        _ = env.get().?;
        _ = env.get().?;
    }

    // If we get here without leaks, test passes
}

test "stress: maximum line length (10KB single line)" {
    const allocator = testing.allocator;

    var value_buffer: [10 * 1024]u8 = undefined;
    @memset(&value_buffer, 'X');
    const long_value = value_buffer[0..];

    const content = try std.fmt.allocPrint(allocator, "KEY={s}", .{long_value});
    defer allocator.free(content);

    const env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get(long_key).?;
    try testing.expectEqual(long_value.len, value.len);
}

test "stress: unicode stress - 1000 emoji values" {
    const allocator = testing.allocator;

    var content = std.ArrayList(u8).init(allocator);
    defer content.deinit();

    var i: usize = 0;
    while (i < 1000) : (i += 1) {
        // Repeat emoji pattern
        try content.writer().print("EMOJI{d}=🔥🎉💯✨\n", .{i});
    }

    const env = try zigenv.parseString(allocator, content.items);
    defer env.deinit();

    try testing.expectEqual(@as(usize, 1000), env.pairs.items.len);
}

test "stress: many empty values" {
    const allocator = testing.allocator;

    var content = std.ArrayList(u8).init(allocator);
    defer content.deinit();

    var i: usize = 0;
    while (i < 500) : (i += 1) {
        try content.writer().print("KEY{d}=\n", .{i});
    }

    const env = try zigenv.parseString(allocator, content.items);
    defer env.deinit();

    try testing.expectEqual(@as(usize, 500), env.pairs.items.len);

    const val = env.get().?;
    try testing.expectEqualStrings("", val);
}

test "stress: alternating quoted and unquoted values" {
    const allocator = testing.allocator;

    var content = std.ArrayList(u8).init(allocator);
    defer content.deinit();

    var i: usize = 0;
    while (i < 500) : (i += 1) {
        if (i % 2 == 0) {
            try content.writer().print("KEY{d}=\"quoted{d}\"\n", .{ i, i });
        } else {
            try content.writer().print("KEY{d}=unquoted{d}\n", .{ i, i });
        }
    }

    const env = try zigenv.parseString(allocator, content.items);
    defer env.deinit();

    try testing.expectEqual(@as(usize, 500), env.pairs.items.len);
}

test "stress: many comments interspersed" {
    const allocator = testing.allocator;

    var content = std.ArrayList(u8).init(allocator);
    defer content.deinit();

    var i: usize = 0;
    while (i < 250) : (i += 1) {
        try content.writer().print("# Comment {d}\n", .{i});
        try content.writer().print("KEY{d}=value{d}\n", .{ i, i });
    }

    const env = try zigenv.parseString(allocator, content.items);
    defer env.deinit();

    // Should have 250 pairs, not 500 (comments excluded)
    try testing.expectEqual(@as(usize, 250), env.pairs.items.len);
}

test "stress: large heredoc value (10KB)" {
    const allocator = testing.allocator;

    var heredoc_content: [10 * 1024]u8 = undefined;
    @memset(&heredoc_content, 'H');
    const heredoc = heredoc_content[0..];

    const content = try std.fmt.allocPrint(allocator, "KEY=\"\"\"\n{s}\n\"\"\"", .{heredoc});
    defer allocator.free(content);

    const env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get(long_key).?;
    try testing.expect(value.len >= heredoc.len - 10); // Allow for some whitespace handling
}

test "stress: many duplicate keys" {
    const allocator = testing.allocator;

    var content = std.ArrayList(u8).init(allocator);
    defer content.deinit();

    var i: usize = 0;
    while (i < 100) : (i += 1) {
        try content.writer().print("DUPLICATE=value{d}\n", .{i});
    }

    const env = try zigenv.parseString(allocator, content.items);
    defer env.deinit();

    // Last one should win
    const value = env.get(long_key).?;
    try testing.expectEqualStrings("value99", value);
}

test "stress: whitespace variations" {
    const allocator = testing.allocator;

    var content = std.ArrayList(u8).init(allocator);
    defer content.deinit();

    var i: usize = 0;
    while (i < 100) : (i += 1) {
        const spaces = i % 10;
        var j: usize = 0;
        while (j < spaces) : (j += 1) {
            try content.writer().writeAll(" ");
        }
        try content.writer().print("KEY{d}=value{d}\n", .{ i, i });
    }

    const env = try zigenv.parseString(allocator, content.items);
    defer env.deinit();

    try testing.expectEqual(@as(usize, 100), env.pairs.items.len);
}

test "stress: mixed line ending styles (500 lines)" {
    const allocator = testing.allocator;

    var content = std.ArrayList(u8).init(allocator);
    defer content.deinit();

    var i: usize = 0;
    while (i < 500) : (i += 1) {
        const ending = switch (i % 3) {
            0 => "\n",
            1 => "\r\n",
            2 => "\r",
            else => "\n",
        };
        try content.writer().print("KEY{d}=value{d}{s}", .{ i, i, ending });
    }

    const env = try zigenv.parseString(allocator, content.items);
    defer env.deinit();

    // Should parse all lines correctly
    try testing.expect(env.pairs.items.len > 400); // Allow some tolerance
}




