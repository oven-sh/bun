const std = @import("std");
const c = @cImport(@cInclude("string.h"));

fn exportAndTrack(
    comptime function_names: *[]const []const u8,
    comptime name: []const u8,
    comptime function: anytype,
) void {
    comptime std.debug.assert(@typeInfo(@TypeOf(function)) == .Fn);
    function_names.* = function_names.* ++ &[_][]const u8{name};
    @export(function, .{ .name = name });
}

/// if number is a floating-point type and NaN, change it to the canonical NaN for that type.
/// otherwise return number unchanged.
fn purifyNan(number: anytype) @TypeOf(number) {
    const T = @TypeOf(number);
    if (@typeInfo(T) == .Float and std.math.isNan(number)) {
        return std.math.nan(T);
    } else {
        return number;
    }
}

fn markAsCalled(name: []const u8) void {
    for (functions_not_called, 0..) |uncalled_name, i| {
        if (std.mem.eql(u8, name, uncalled_name)) {
            std.mem.swap([]const u8, &functions_not_called[i], &functions_not_called[functions_not_called.len - 1]);
            functions_not_called = functions_not_called[0 .. functions_not_called.len - 1];
            break;
        }
    }
}

/// Export a function named `name` which records that it has been called and then returns `value`
fn exportReturns(
    comptime function_names: *[]const []const u8,
    comptime name: []const u8,
    comptime T: type,
    comptime value: T,
) void {
    exportAndTrack(function_names, name, struct {
        fn returns() callconv(.C) T {
            markAsCalled(name);
            return value;
        }
    }.returns);
}

/// Export a function named `name` which takes one parameter of type T and returns it. If T is a
/// floating-point type, NaN arguments are purified.
fn exportIdentity(
    comptime function_names: *[]const []const u8,
    comptime name: []const u8,
    comptime T: type,
) void {
    exportAndTrack(function_names, name, struct {
        fn identity(x: T) callconv(.C) T {
            markAsCalled(name);
            return purifyNan(x);
        }
    }.identity);
}

/// Export a function named `name` which takes two parameters of type T and returns their sum.
fn exportAdd(
    comptime function_names: *[]const []const u8,
    comptime name: []const u8,
    comptime T: type,
) void {
    exportAndTrack(function_names, name, struct {
        fn add(a: T, b: T) callconv(.C) T {
            markAsCalled(name);
            return a + b;
        }
    }.add);
}

/// Export a function named `name` which accepts a callback returning T, and returns what that
/// callback returns
fn exportCallbackIdentity(
    comptime function_names: *[]const []const u8,
    comptime name: []const u8,
    comptime T: type,
) void {
    exportAndTrack(function_names, name, struct {
        fn entrypoint(cb: *const fn () callconv(.C) T, result: *T) void {
            result.* = purifyNan(cb());
        }

        fn callbackIdentity(cb: *const fn () callconv(.C) T) callconv(.C) T {
            markAsCalled(name);
            var result: T = undefined;
            var thread = std.Thread.spawn(.{}, entrypoint, .{ cb, &result }) catch unreachable;
            thread.join();
            return result;
        }
    }.callbackIdentity);
}

fn cName(comptime T: type) []const u8 {
    return switch (T) {
        f32 => "float",
        f64 => "double",
        c_char => "char",
        else => {
            const int = @typeInfo(T).Int;
            return switch (int.signedness) {
                .unsigned => std.fmt.comptimePrint("uint{}_t", .{int.bits}),
                .signed => std.fmt.comptimePrint("int{}_t", .{int.bits}),
            };
        },
    };
}

var @"42": i32 = 42;
fn returnPointerTo42() callconv(.C) *i32 {
    markAsCalled("ptr_should_point_to_42_as_int32_t");
    return &@"42";
}

fn memsetAndMemcpyWork() callconv(.C) bool {
    markAsCalled("memset_and_memcpy_work");
    var dst = [1]u8{0} ** 10;
    var src = [1]u8{0} ** 10;

    const dst_opaque: *anyopaque = @ptrCast(&dst);
    const src_opaque: *anyopaque = @ptrCast(&src);

    if (c.memset(&src, 5, 9) != src_opaque) {
        return false;
    }

    // should set 9 items to 5 and leave the 10th unchanged
    for (0..9) |i| {
        if (src[i] != 5) return false;
    }
    if (src[9] != 0) return false;

    // prepare some values
    for (&src, 0..) |*s, i| {
        s.* = @intCast(i + 1);
    }

    if (c.memcpy(&dst, &src, 9) != dst_opaque) {
        return false;
    }

    // first 9 items of dst should match src
    for (dst[0..9], src[0..9]) |d, s| {
        if (d != s) return false;
    }
    // 10th item of dst should be unchanged
    if (dst[9] != 0) return false;

    return true;
}

fn returnTrueCallback() callconv(.C) bool {
    markAsCalled("return_true_callback");
    return true;
}

fn returnFunctionReturningTrue() callconv(.C) *const fn () callconv(.C) bool {
    markAsCalled("return_a_function_ptr_to_function_that_returns_true");
    return &returnTrueCallback;
}

fn isNull(ptr: ?*i32) callconv(.C) bool {
    markAsCalled("is_null");
    return ptr == null;
}

fn pointsTo42(ptr: ?*const i32) callconv(.C) bool {
    markAsCalled("does_pointer_equal_42_as_int32_t");
    return ptr.?.* == 42;
}

var all_function_names = blk: {
    var function_names: []const []const u8 = &.{};

    for (.{
        u8,  u16, u32,    u64,
        i8,  i16, i32,    i64,
        f32, f64, c_char,
    }) |T| {
        if (T != c_char and @typeInfo(T) == .Int and @typeInfo(T).Int.signedness == .signed) {
            exportReturns(&function_names, "returns_neg_42_" ++ cName(T), T, -42);
        } else {
            exportReturns(&function_names, "returns_42_" ++ cName(T), T, 42);
        }

        exportIdentity(&function_names, "identity_" ++ cName(T), T);
        exportAdd(&function_names, "add_" ++ cName(T), T);
        exportCallbackIdentity(&function_names, "cb_identity_" ++ cName(T), T);
    }

    exportReturns(&function_names, "returns_true", bool, true);
    exportReturns(&function_names, "returns_false", bool, false);

    exportIdentity(&function_names, "identity_bool", bool);
    exportIdentity(&function_names, "identity_ptr", *anyopaque);

    exportCallbackIdentity(&function_names, "cb_identity_bool", bool);

    exportAndTrack(&function_names, "ptr_should_point_to_42_as_int32_t", returnPointerTo42);
    exportAndTrack(&function_names, "memset_and_memcpy_work", memsetAndMemcpyWork);
    exportAndTrack(&function_names, "return_true_callback", returnTrueCallback);
    exportAndTrack(&function_names, "return_a_function_ptr_to_function_that_returns_true", returnFunctionReturningTrue);
    exportAndTrack(&function_names, "does_pointer_equal_42_as_int32_t", pointsTo42);

    break :blk function_names[0..].*;
};

var functions_not_called: [][]const u8 = &all_function_names;

export fn logUncalled() void {
    if (functions_not_called.len > 0) {
        std.debug.print("these functions were not called:\n", .{});
        for (functions_not_called) |name| {
            std.debug.print("    {s}\n", .{name});
        }
    }
}
