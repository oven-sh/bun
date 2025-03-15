const std = @import("std");
// const bun = @import("root").bun;
const t = std.testing;

// comptime {
//     // _ = bun;
//     refAllDeclsRecursive(bun);

// }

// pub fn refAllDeclsRecursive(comptime T: type) void {
//     inline for (comptime std.meta.declarations(T)) |decl| {
//         if (@TypeOf(@field(T, decl.name)) == type) {
//             switch (@typeInfo(@field(T, decl.name))) {
//                 .@"struct", .@"enum", .@"union", .@"opaque" => refAllDeclsRecursive(@field(T, decl.name)),
//                 else => {},
//             }
//         }
//         _ = &@field(T, decl.name);
//     }
// }
test {
    // std.mem.doNotOptimizeAway(bun);
    // std.testing.refAllDeclsRecursive(bun);
    // try t.expectEqual(1, 1);
    // bun.assert(true);
    // const _main = @import("root").main;
    // @compileLog(_main);
    // @compileError("foo");

    try std.testing.expectEqual(2, add(1, 1));
}

fn add (a: i32, b: i32) i32 {
    return a + b;
}
