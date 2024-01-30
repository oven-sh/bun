const std = @import("std");

pub fn toNTPath(wbuf: []u16, utf8: []const u8) [:0]const u16 {
    if (!std.fs.path.isAbsoluteWindows(utf8)) {
        return toWPathNormalized(wbuf, utf8);
    }

    wbuf[0..4].* = [_]u16{ '\\', '?', '?', '\\' };
    return wbuf[0 .. toWPathNormalized(wbuf[4..], utf8).len + 4 :0];
}

// These are the same because they don't have rules like needing a trailing slash
pub const toNTDir = toNTPath;

pub fn toExtendedPathNormalized(wbuf: []u16, utf8: []const u8) [:0]const u16 {
    std.debug.assert(wbuf.len > 4);
    wbuf[0..4].* = [_]u16{ '\\', '\\', '?', '\\' };
    return wbuf[0 .. toWPathNormalized(wbuf[4..], utf8).len + 4 :0];
}

pub fn toWPathNormalizeAutoExtend(wbuf: []u16, utf8: []const u8) [:0]const u16 {
    if (std.fs.path.isAbsoluteWindows(utf8)) {
        return toExtendedPathNormalized(wbuf, utf8);
    }

    return toWPathNormalized(wbuf, utf8);
}

pub fn toWPathNormalized(wbuf: []u16, utf8: []const u8) [:0]const u16 {
    var renormalized: []u8 = undefined;
    var path_to_use = utf8;

    if (std.mem.indexOfScalar(u8, utf8, '/') != null) {
        @memcpy(renormalized[0..utf8.len], utf8);
        for (renormalized[0..utf8.len]) |*c| {
            if (c.* == '/') {
                c.* = '\\';
            }
        }
        path_to_use = renormalized[0..utf8.len];
    }

    // is there a trailing slash? Let's remove it before converting to UTF-16
    if (path_to_use.len > 3 and path_to_use[path_to_use.len - 1] == '\\') {
        path_to_use = path_to_use[0 .. path_to_use.len - 1];
    }

    return toWPath(wbuf, path_to_use);
}

pub fn toWDirNormalized(wbuf: []u16, utf8: []const u8) [:0]const u16 {
    var renormalized: [std.fs.MAX_PATH_BYTES]u8 = undefined;
    var path_to_use = utf8;

    if (std.mem.indexOfScalar(u8, utf8, '.') != null) {
        @memcpy(renormalized[0..utf8.len], utf8);
        for (renormalized[0..utf8.len]) |*c| {
            if (c.* == '/') {
                c.* = '\\';
            }
        }
        path_to_use = renormalized[0..utf8.len];
    }

    return toWDirPath(wbuf, path_to_use);
}

pub fn toWPath(wbuf: []u16, utf8: []const u8) [:0]const u16 {
    return toWPathMaybeDir(wbuf, utf8, false);
}

pub fn toWDirPath(wbuf: []u16, utf8: []const u8) [:0]const u16 {
    return toWPathMaybeDir(wbuf, utf8, true);
}

pub fn toWPathMaybeDir(wbuf: []u16, utf8: []const u8, comptime add_trailing_lash: bool) [:0]const u16 {
    std.debug.assert(wbuf.len > 0);

    const count = std.unicode.utf8ToUtf16Le(wbuf[0..wbuf.len -| (1 + @as(usize, @intFromBool(add_trailing_lash)))], utf8) catch unreachable;

    if (add_trailing_lash and count > 0 and wbuf[count - 1] != '\\') {
        wbuf[count] = '\\';
        count += 1;
    }

    wbuf[count] = 0;

    return wbuf[0..count :0];
}

pub const WindowsWatcher = struct {
    iocp: w.HANDLE,
    allocator: std.mem.Allocator,
    // watchers: Map,
    running: bool = true,

    // const Map = std.AutoArrayHashMap(*w.OVERLAPPED, *DirWatcher);
    const w = std.os.windows;

    const Action = enum(w.DWORD) {
        Added = 1,
        Removed,
        Modified,
        RenamedOld,
        RenamedNew,
    };

    const DirWatcher = extern struct {
        // this must be the first field
        overlapped: w.OVERLAPPED = undefined,
        buf: [64 * 1024]u8 align(@alignOf(w.FILE_NOTIFY_INFORMATION)) = undefined,
        dirHandle: w.HANDLE,
        watch_subtree: w.BOOLEAN = 1,

        fn handleEvent(this: *DirWatcher, nbytes: w.DWORD) void {
            const elapsed = clock1.read();
            std.debug.print("elapsed: {}\n", .{std.fmt.fmtDuration(elapsed)});
            if (nbytes == 0) {
                std.debug.print("nbytes == 0\n", .{});
                return;
            }
            var offset: usize = 0;
            while (true) {
                const info_size = @sizeOf(w.FILE_NOTIFY_INFORMATION);
                const info: *w.FILE_NOTIFY_INFORMATION = @alignCast(@ptrCast(this.buf[offset..].ptr));
                const name_ptr: [*]u16 = @alignCast(@ptrCast(this.buf[offset + info_size ..]));
                const filename: []u16 = name_ptr[0 .. info.FileNameLength / @sizeOf(u16)];

                const action: Action = @enumFromInt(info.Action);
                std.debug.print("filename: {}, action: {s}\n", .{ std.unicode.fmtUtf16le(filename), @tagName(action) });

                if (info.NextEntryOffset == 0) break;
                offset += @as(usize, info.NextEntryOffset);
            }
        }

        fn listen(this: *DirWatcher) !void {
            const filter = w.FILE_NOTIFY_CHANGE_FILE_NAME | w.FILE_NOTIFY_CHANGE_DIR_NAME | w.FILE_NOTIFY_CHANGE_LAST_WRITE | w.FILE_NOTIFY_CHANGE_CREATION;
            if (w.kernel32.ReadDirectoryChangesW(this.dirHandle, &this.buf, this.buf.len, this.watch_subtree, filter, null, &this.overlapped, null) == 0) {
                const err = w.kernel32.GetLastError();
                std.debug.print("failed to start watching directory: {s}\n", .{@tagName(err)});
                @panic("failed to start watching directory");
            }
        }
    };

    pub fn init(allocator: std.mem.Allocator) !*WindowsWatcher {
        const watcher = try allocator.create(WindowsWatcher);
        errdefer allocator.destroy(watcher);

        const iocp = try w.CreateIoCompletionPort(w.INVALID_HANDLE_VALUE, null, 0, 1);
        watcher.* = .{
            .iocp = iocp,
            .allocator = allocator,
        };
        return watcher;
    }

    pub fn deinit(this: *WindowsWatcher) void {
        // get all the directory watchers and close their handles
        // TODO
        // close the io completion port handle
        w.kernel32.CloseHandle(this.iocp);
    }

    pub fn addWatchedDirectory(this: *WindowsWatcher, dirFd: w.HANDLE, path: [:0]const u16) !*DirWatcher {
        std.debug.print("adding directory to watch: {s}\n", .{std.unicode.fmtUtf16le(path)});
        const flags = w.FILE_LIST_DIRECTORY;

        const path_len_bytes: u16 = @truncate(path.len * 2);
        var nt_name = w.UNICODE_STRING{
            .Length = path_len_bytes,
            .MaximumLength = path_len_bytes,
            .Buffer = @constCast(path.ptr),
        };
        var attr = w.OBJECT_ATTRIBUTES{
            .Length = @sizeOf(w.OBJECT_ATTRIBUTES),
            .RootDirectory = if (std.fs.path.isAbsoluteWindowsW(path))
                null
            else if (dirFd == w.INVALID_HANDLE_VALUE)
                std.fs.cwd().fd
            else
                dirFd,
            .Attributes = 0, // Note we do not use OBJ_CASE_INSENSITIVE here.
            .ObjectName = &nt_name,
            .SecurityDescriptor = null,
            .SecurityQualityOfService = null,
        };
        var handle: w.HANDLE = w.INVALID_HANDLE_VALUE;
        var io: w.IO_STATUS_BLOCK = undefined;
        const rc = w.ntdll.NtCreateFile(
            &handle,
            flags,
            &attr,
            &io,
            null,
            0,
            w.FILE_SHARE_READ | w.FILE_SHARE_WRITE | w.FILE_SHARE_DELETE,
            w.FILE_OPEN,
            w.FILE_DIRECTORY_FILE | w.FILE_OPEN_FOR_BACKUP_INTENT,
            null,
            0,
        );

        if (rc != .SUCCESS) {
            std.debug.print("failed to open directory for watching: {s}\n", .{@tagName(rc)});
            @panic("failed to open directory for watching");
        }

        errdefer _ = w.kernel32.CloseHandle(handle);

        this.iocp = try w.CreateIoCompletionPort(handle, this.iocp, 0, 1);

        std.debug.print("handle: {d}\n", .{@intFromPtr(handle)});

        const watcher = try this.allocator.create(DirWatcher);
        errdefer this.allocator.destroy(watcher);
        watcher.* = .{ .dirHandle = handle };
        // try this.watchers.put(key, watcher);
        try watcher.listen();

        return watcher;
    }

    pub fn stop(this: *WindowsWatcher) void {
        // close all the handles
        // w.kernel32.PostQueuedCompletionStatus(this.iocp, 0, 1, )
        @atomicStore(bool, &this.running, false, .Unordered);
    }

    pub fn run(this: *WindowsWatcher) !void {
        var nbytes: w.DWORD = 0;
        var key: w.ULONG_PTR = 0;
        var overlapped: ?*w.OVERLAPPED = null;
        while (true) {
            switch (w.GetQueuedCompletionStatus(this.iocp, &nbytes, &key, &overlapped, w.INFINITE)) {
                .Normal => {},
                .Aborted => @panic("aborted"),
                .Cancelled => @panic("cancelled"),
                .EOF => @panic("eof"),
            }
            if (nbytes == 0) {
                // exit notification for this watcher - we should probably deallocate it here
                continue;
            }

            const watcher: *DirWatcher = @ptrCast(overlapped);
            watcher.handleEvent(nbytes);
            try watcher.listen();

            if (@atomicLoad(bool, &this.running, .Unordered) == false) {
                break;
            }
        }
    }
};

var clock1: std.time.Timer = undefined;
const data: [1 << 10]u8 = std.mem.zeroes([1 << 10]u8);

pub fn main() !void {
    const allocator = std.heap.page_allocator;

    var buf: [std.fs.MAX_PATH_BYTES]u16 = undefined;

    const watchdir = "C:\\bun";
    const iconsdir = "C:\\test\\node_modules\\@mui\\icons-material";
    _ = iconsdir; // autofix
    const testdir = "C:\\test\\node_modules\\@mui\\icons-material\\mydir";
    _ = testdir; // autofix
    const testfile = "C:\\test\\node_modules\\@mui\\icons-material\\myfile.txt";
    _ = testfile; // autofix

    // try std.fs.deleteDirAbsolute(dir);

    const watcher = try WindowsWatcher.init(allocator);
    var handle = try std.Thread.spawn(.{}, WindowsWatcher.run, .{watcher});
    std.time.sleep(100_000_000);
    const watched = try watcher.addWatchedDirectory(std.os.windows.INVALID_HANDLE_VALUE, toNTPath(&buf, watchdir));
    // try watcher.addWatchedDirectory(std.os.windows.INVALID_HANDLE_VALUE, toNTPath(&buf, "C:\\bun\\src"));
    // try watcher.addWatchedDirectory(std.os.windows.INVALID_HANDLE_VALUE, toNTPath(&buf, "C:\\bun\\test"));
    // try watcher.addWatchedDirectory(std.os.windows.INVALID_HANDLE_VALUE, toNTPath(&buf, "C:\\bun\\testdir"));

    // const file = try std.fs.createFileAbsolute(testfile, .{});
    std.debug.print("watcher started\n", .{});

    clock1 = try std.time.Timer.start();
    // try std.fs.makeDirAbsolute(dir);
    // try file.writeAll(&data);

    // _ = std.os.windows.ntdll.NtClose(watched.dirHandle);
    _ = watched;

    handle.join();
}
