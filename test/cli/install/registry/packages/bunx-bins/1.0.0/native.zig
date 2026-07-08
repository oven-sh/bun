const std = @import("std");

pub fn main() !void {
    const out = std.io.getStdOut().writer();
    try out.print("i am exe", .{});
    const args = try std.process.argsAlloc(std.heap.page_allocator);
    defer std.process.argsFree(std.heap.page_allocator, args);
    for (args[1..]) |arg| {
        try out.print(" {s}", .{arg});
    }
    try out.print("\n", .{});
}
