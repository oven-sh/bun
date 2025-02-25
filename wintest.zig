const std = @import("std");
pub const ENABLE_LINE_INPUT = 0x002;
pub const ENABLE_VIRTUAL_TERMINAL_INPUT = 0x200;

const Environment = struct {
    const isWindows = true;
};

const bun = struct {
    const windows = struct {
        const std_os_windows = std.os.windows;
        pub const kernel32 = std_os_windows.kernel32;

        pub const ENABLE_LINE_INPUT = 0x002;
        pub const ENABLE_VIRTUAL_TERMINAL_INPUT = 0x200;
        pub const ENABLE_WRAP_AT_EOL_OUTPUT = 0x0002;
        pub const ENABLE_PROCESSED_OUTPUT = 0x0001;
        pub const DWORD = std_os_windows.DWORD;
        const SetConsoleMode = kernel32.SetConsoleMode;
        const GetConsoleMode = kernel32.GetConsoleMode;
    };
    pub const win32 = struct {
        /// Returns the original mode, or null on failure
        pub fn updateStdioModeFlags(i: anytype, opts: struct { set: windows.DWORD = 0, unset: windows.DWORD = 0 }) !windows.DWORD {
            const fd = stdio(i);
            var original_mode: windows.DWORD = 0;
            if (windows.GetConsoleMode(fd, &original_mode) != 0) {
                if (windows.SetConsoleMode(fd, (original_mode | opts.set) & ~opts.unset) == 0) {
                    return error.WindowsError; // windows.getLastError
                }
            } else return error.WindowsError; // windows.getLastError
            return original_mode;
        }
        const FileDescriptor = *anyopaque;
    pub var STDOUT_FD: FileDescriptor = undefined;
    pub var STDERR_FD: FileDescriptor = undefined;
    pub var STDIN_FD: FileDescriptor = undefined;
    pub fn stdio(i: anytype) FileDescriptor {
        return switch (i) {
            0 => STDIN_FD,
            1 => STDOUT_FD,
            2 => STDERR_FD,
            else => @panic("Invalid stdio fd"),
        };
    }
    };
};

pub fn main() !void {

      bun.win32.STDIN_FD = std.os.windows.GetStdHandle(std.os.windows.STD_INPUT_HANDLE) catch @panic("uhoh");
      bun.win32.STDOUT_FD = std.os.windows.GetStdHandle(std.os.windows.STD_OUTPUT_HANDLE) catch @panic("uhoh");
      bun.win32.STDERR_FD = std.os.windows.GetStdHandle(std.os.windows.STD_ERROR_HANDLE) catch @panic("uhoh");


    const original_mode: if (Environment.isWindows) ?bun.windows.DWORD else void = if (comptime Environment.isWindows)
        bun.win32.updateStdioModeFlags(0, .{ .set = bun.windows.ENABLE_VIRTUAL_TERMINAL_INPUT, .unset = bun.windows.ENABLE_LINE_INPUT }) catch null;

    defer {
        if (comptime Environment.isWindows) {
            if (original_mode) |mode| {
                _ = bun.windows.SetConsoleMode(
                    bun.win32.STDIN_FD,
                    mode,
                );
            }
        }
    }

    while (true) {
        const byte = std.io.getStdIn().reader().readByte() catch |e| {
            std.log.info("got error: {s}", .{@errorName(e)});
            return;
        };

        std.log.info("got byte: {c}", .{byte});
    }
}
