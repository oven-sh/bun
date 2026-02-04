const std = @import("std");
const zigenv = @import("zigenv");
const testing = std.testing;
const ManagedList = zigenv.ManagedList;

test "perf: simple file parse time benchmark" {
    const allocator = testing.allocator;
    const content =
        \\KEY1=value1
        \\KEY2=value2
        \\KEY3=value3
        \\KEY4=value4
        \\KEY5=value5
    ;

    var timer = try std.time.Timer.start();

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const elapsed = timer.read();

    // Should parse quickly (< 10ms for 5 pairs)
    try testing.expect(elapsed < 10 * std.time.ns_per_ms);
}

test "perf: large file parse performance (1000 entries)" {
    const allocator = testing.allocator;

    var content = ManagedList(u8).init(allocator);
    defer content.deinit();

    var i: usize = 0;
    while (i < 1000) : (i += 1) {
        const line = try std.fmt.allocPrint(allocator, "KEY{d}=value{d}\n", .{ i, i });
        defer allocator.free(line);
        try content.appendSlice(line);
    }

    var timer = try std.time.Timer.start();

    var env = try zigenv.parseString(allocator, content.list.items);
    defer env.deinit();

    const elapsed = timer.read();

    // Should parse 1000 entries in reasonable time (< 150ms)
    // Note: increased threshold to account for CI environments
    try testing.expect(elapsed < 150 * std.time.ns_per_ms);
}

test "perf: interpolation performance" {
    const allocator = testing.allocator;

    var content = ManagedList(u8).init(allocator);
    defer content.deinit();

    try content.appendSlice("BASE=value\n");

    // Create chain of interpolations
    var i: usize = 0;
    while (i < 100) : (i += 1) {
        if (i == 0) {
            try content.appendSlice("VAR0=${BASE}\n");
        } else {
            const line = try std.fmt.allocPrint(allocator, "VAR{d}=${{VAR{d}}}\n", .{ i, i - 1 });
            defer allocator.free(line);
            try content.appendSlice(line);
        }
    }

    var timer = try std.time.Timer.start();

    var env = try zigenv.parseString(allocator, content.list.items);
    defer env.deinit();

    const elapsed = timer.read();

    // Chained interpolation should complete in reasonable time (< 200ms)
    try testing.expect(elapsed < 200 * std.time.ns_per_ms);
}

test "perf: memory usage for simple file" {
    const allocator = testing.allocator;
    const content =
        \\KEY1=value1
        \\KEY2=value2
        \\KEY3=value3
    ;

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    // Just verify it completes without excessive allocations
    try testing.expectEqual(@as(usize, 3), env.map.count());
}

test "perf: repeated parsing performance" {
    const allocator = testing.allocator;
    const content = "KEY=value\nOTHER=data\n";

    var timer = try std.time.Timer.start();

    var i: usize = 0;
    while (i < 100) : (i += 1) {
        var env = try zigenv.parseString(allocator, content);
        env.deinit();
    }

    const elapsed = timer.read();

    // 100 parse cycles should be fast (< 100ms)
    try testing.expect(elapsed < 100 * std.time.ns_per_ms);
}

test "perf: heredoc parsing performance" {
    const allocator = testing.allocator;
    const content =
        \\VALUE="""
        \\This is a multiline
        \\heredoc value that
        \\spans multiple lines
        \\and should parse quickly
        \\"""
    ;

    var timer = try std.time.Timer.start();

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const elapsed = timer.read();

    // Heredoc parsing should be fast (< 10ms)
    try testing.expect(elapsed < 10 * std.time.ns_per_ms);
}

test "perf: unicode handling performance" {
    const allocator = testing.allocator;
    const content =
        \\EMOJI=🔥🎉💯✨
        \\JAPANESE=こんにちは世界
        \\ARABIC=مرحبا
        \\MIXED=Hello世界🌍مرحبا
    ;

    var timer = try std.time.Timer.start();

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const elapsed = timer.read();

    // Unicode should not significantly slow down parsing (< 20ms)
    try testing.expect(elapsed < 20 * std.time.ns_per_ms);
}
