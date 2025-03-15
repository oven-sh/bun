const std = @import("std");
const bun = @import("root").bun;
const t = std.testing;

fn add(a: i32, b: i32) i32 {
    return a + b;
}

test {
    try std.testing.expectEqual(2, add(1, 1));
}

test "idk strings or something" {
    var s = bun.String.createUTF8("hi"); // it can create `WTF::String`s too
    defer s.deref();
    try t.expectEqual(s.length(), 2);
    try t.expectEqualStrings(s.asUTF8().?, "hi");
}

// tests have panic recovery
test "uh oh" {
    @panic("oh no"); 
}

// stack traces to allocations print when a leak is found
test "forgot to deinit" {
    var bytes = try t.allocator.alloc(u8, 1);
    _ = &bytes;
}
