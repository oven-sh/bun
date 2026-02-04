const std = @import("std");

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const file = try std.fs.cwd().createFile("tests/fixtures/large_10k.env", .{});
    defer file.close();

    // Generate 10,000 key-value pairs
    try file.writeAll("# Large auto-generated test file with 10,000 entries\n");

    var i: usize = 0;
    while (i < 10000) : (i += 1) {
        const key = try std.fmt.allocPrint(allocator, "KEY_{d:0>5}", .{i});
        defer allocator.free(key);

        const value = try std.fmt.allocPrint(allocator, "value_{d}_data", .{i});
        defer allocator.free(value);

        const line = try std.fmt.allocPrint(allocator, "{s}={s}\n", .{ key, value });
        defer allocator.free(line);
        try file.writeAll(line);

        // Add some variety
        if (i % 100 == 0) {
            try file.writeAll("# Checkpoint comment\n");
        }
        if (i % 250 == 0) {
            const interp_key = try std.fmt.allocPrint(allocator, "INTERP_{d:0>5}", .{i});
            defer allocator.free(interp_key);
            const interp_line = try std.fmt.allocPrint(allocator, "{s}=${{KEY_{d:0>5}}}_interpolated\n", .{ interp_key, i });
            defer allocator.free(interp_line);
            try file.writeAll(interp_line);
        }
    }

    try file.writeAll("# End of large file\n");
    std.debug.print("Generated large_10k.env with 10,000+ entries\n", .{});
}
