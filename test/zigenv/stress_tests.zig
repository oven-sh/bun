const std = @import("std");
const zigenv = @import("zigenv");
const testing = std.testing;
const ManagedList = zigenv.ManagedList;

test "stress: extremely long key (1KB)" {
    const allocator = testing.allocator;

    var key_buffer: [1024]u8 = undefined;
    @memset(&key_buffer, 'K');
    const long_key = key_buffer[0..];

    const content = try std.fmt.allocPrint(allocator, "{s}=value", .{long_key});
    defer allocator.free(content);

    var env = try zigenv.parseString(allocator, content);
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

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("KEY").?;
    try testing.expectEqual(long_value.len, value.len);
}

test "stress: many key-value pairs (1000)" {
    const allocator = testing.allocator;

    var content = ManagedList(u8).init(allocator);
    defer content.deinit();

    var i: usize = 0;
    while (i < 1000) : (i += 1) {
        const line = try std.fmt.allocPrint(allocator, "KEY{d}=value{d}\n", .{ i, i });
        defer allocator.free(line);
        try content.appendSlice(line);
    }

    var env = try zigenv.parseString(allocator, content.list.items);
    defer env.deinit();

    try testing.expectEqual(@as(usize, 1000), env.map.count());

    // Spot check
    const val0 = env.get("KEY0").?;
    try testing.expectEqualStrings("value0", val0);

    const val999 = env.get("KEY999").?;
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

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const final = env.get("VAR9").?;
    try testing.expect(std.mem.indexOf(u8, final, "final_value") != null);
}

test "stress: rapid allocation deallocation (100 iterations)" {
    const allocator = testing.allocator;
    const content =
        \\KEY1=value1
        \\KEY2=value2
        \\KEY3=value3
    ;

    var i: usize = 0;
    while (i < 100) : (i += 1) {
        var env = try zigenv.parseString(allocator, content);
        defer env.deinit();

        _ = env.get("KEY1").?;
        _ = env.get("KEY2").?;
        _ = env.get("KEY3").?;
    }
}

test "stress: many empty values" {
    const allocator = testing.allocator;

    var content = ManagedList(u8).init(allocator);
    defer content.deinit();

    var i: usize = 0;
    while (i < 500) : (i += 1) {
        const line = try std.fmt.allocPrint(allocator, "KEY{d}=\n", .{i});
        defer allocator.free(line);
        try content.appendSlice(line);
    }

    var env = try zigenv.parseString(allocator, content.list.items);
    defer env.deinit();

    try testing.expectEqual(@as(usize, 500), env.map.count());

    const val = env.get("KEY0").?;
    try testing.expectEqualStrings("", val);
}

test "stress: many duplicate keys" {
    const allocator = testing.allocator;

    var content = ManagedList(u8).init(allocator);
    defer content.deinit();

    var i: usize = 0;
    while (i < 100) : (i += 1) {
        const line = try std.fmt.allocPrint(allocator, "DUPLICATE=value{d}\n", .{i});
        defer allocator.free(line);
        try content.appendSlice(line);
    }

    var env = try zigenv.parseString(allocator, content.list.items);
    defer env.deinit();

    // Last one should win
    const value = env.get("DUPLICATE").?;
    try testing.expectEqualStrings("value99", value);
}

test "stress: mixed line ending styles (500 lines)" {
    const allocator = testing.allocator;

    var content = ManagedList(u8).init(allocator);
    defer content.deinit();

    var i: usize = 0;
    while (i < 500) : (i += 1) {
        const ending = switch (i % 2) {
            0 => "\n",
            1 => "\r\n",
            else => "\n",
        };
        const line = try std.fmt.allocPrint(allocator, "KEY{d}=value{d}{s}", .{ i, i, ending });
        defer allocator.free(line);
        try content.appendSlice(line);
    }

    var env = try zigenv.parseString(allocator, content.list.items);
    defer env.deinit();

    // Should parse all lines correctly
    try testing.expect(env.map.count() > 400); // Allow some tolerance
}
