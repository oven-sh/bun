const std = @import("std");
const unistd = @cImport(@cInclude("unistd.h"));

//pub fn get_total_memory() u64 {
//    const pages = uinstd.sysconf(uinstd._SC_PHYS_PAGES);
//    const page_size = uinstd.sysconf(uinstd._SC_PAGE_SIZE);
//
//    return @bitCast(u64, pages) * @bitCast(u64, page_size);
//}
const sysResource = @cImport(@cInclude("sys/resource.h"));

pub const CpuInfo = struct {
    model: []const u8 = undefined,
    speed: i64 = undefined,
};

pub fn get_cpu_count() c_long {
    return unistd.sysconf(unistd._SC_NPROCESSORS_ONLN);
}

pub fn get_cpus_info() anyerror!?[]CpuInfo {
    var file = std.fs.openFileAbsolute("/proc/cpuinfo", .{ .intended_io_mode = .blocking }) catch {
        return null;
    };
    defer file.close();

    const reader = file.reader();

    var line_buf: [1024]u8 = undefined;

    var cores = std.ArrayList(CpuInfo).init(std.heap.page_allocator);
    defer cores.deinit();

    while (true) {
        const line = (try reader.readUntilDelimiterOrEof(&line_buf, '\n')) orelse break;
        const colon_pos = std.mem.indexOfScalar(u8, line, ':') orelse continue;
        const key = std.mem.trimRight(u8, line[0..colon_pos], " \t");
        const value = std.mem.trimLeft(u8, line[colon_pos + 1 ..], " \t");

        if (std.mem.eql(u8, key, "processor")) {
            _ = cores.append(.{}) catch unreachable;
        } else if (std.mem.eql(u8, key, "model name") or std.mem.eql(u8, key, "cpu")) {
            cores.items[cores.items.len - 1].model = std.heap.page_allocator.dupe(u8, value) catch "-";
        } else if (std.mem.eql(u8, key, "cpu MHz") or std.mem.eql(u8, key, "clock")) {
            cores.items[cores.items.len - 1].speed = @floatToInt(i64, std.fmt.parseFloat(f64, value) catch 0);
        }
    }

    std.debug.print("{any}", .{cores.items});
    return cores.items;
}

pub fn main() !void {
    std.debug.print("priority: {}\n", .{sysResource.getpriority(sysResource.PRIO_PROCESS, 0)});
    std.debug.print("set priority: {}\n", .{sysResource.setpriority(sysResource.PRIO_PROCESS, 0, -1)});
    std.debug.print("priority: {}\n", .{sysResource.getpriority(sysResource.PRIO_PROCESS, 0)});
    std.debug.print("num of procs: {}\n", .{unistd.sysconf(unistd._SC_NPROCESSORS_ONLN)});
    std.debug.print("uid: {}\n", .{unistd.getuid()});
    std.debug.print("gid: {}\n", .{unistd.getgid()});
    //std.debug.print("info: {any}\n", .{get_cpus_info()});
    _ = get_cpus_info() catch unreachable;
    //std.debug.print("test: {any}\n", .{getInfo()});
    //std.debug.print("FREE: {}", .{pages2 * page_size});
}
