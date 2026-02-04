const std = @import("std");
const testing = std.testing;
const zigenv = @import("zigenv");
const ParserOptions = zigenv.ParserOptions;

test "Bun Integration: export prefix memory check" {
    const allocator = testing.allocator;
    var opts = ParserOptions.defaults();
    opts.support_export_prefix = true;

    const content = "export MY_KEY=value\nexport ANOTHER=val";
    // Loop to ensure stability over multiple allocations if any caching exists (unlikely but good for stress)
    for (0..5) |_| {
        var env = try zigenv.parseStringWithOptions(allocator, content, opts, null, null);
        defer env.deinit();

        try testing.expectEqualStrings("value", env.get("MY_KEY").?);
        try testing.expectEqualStrings("val", env.get("ANOTHER").?);
    }
}

test "Bun Integration: colon separator memory check" {
    const allocator = testing.allocator;
    var opts = ParserOptions.defaults();
    opts.support_colon_separator = true;

    const content = "KEY: value\nNEXT: val\nMIXED=standard";

    var env = try zigenv.parseStringWithOptions(allocator, content, opts, null, null);
    defer env.deinit();

    try testing.expectEqualStrings("value", env.get("KEY").?);
    try testing.expectEqualStrings("val", env.get("NEXT").?);
    try testing.expectEqualStrings("standard", env.get("MIXED").?);
}

test "Bun Integration: interpolation defaults memory check" {
    const allocator = testing.allocator;
    // Test with missing variable (using default) and existing variable (ignoring default)
    const content =
        \\VAL=${MISSING:-default_value}
        \\EXISTING=real
        \\CHECK=${EXISTING:-fallback}
        \\NESTED=${MISSING:-${EXISTING:-unused}}
    ;

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("default_value", env.get("VAL").?);
    try testing.expectEqualStrings("real", env.get("CHECK").?);
    try testing.expectEqualStrings("real", env.get("NESTED").?);
}

test "Bun Integration: external lookup memory check" {
    const allocator = testing.allocator;
    const content = "GREETING=${USER_NAME}\nFALLBACK=${MISSING:-default}";

    const Context = struct {
        pub fn lookup(_: ?*anyopaque, key: []const u8) ?[]const u8 {
            if (std.mem.eql(u8, key, "USER_NAME")) return "Admin";
            return null;
        }
    };

    var env = try zigenv.parseStringWithOptions(allocator, content, ParserOptions.defaults(), Context.lookup, null);
    defer env.deinit();

    try testing.expectEqualStrings("Admin", env.get("GREETING").?);
    try testing.expectEqualStrings("default", env.get("FALLBACK").?);
}

test "Bun Integration: mixed features stress test" {
    const allocator = testing.allocator;
    var opts = ParserOptions.defaults();
    opts.support_export_prefix = true;
    opts.support_colon_separator = true;

    const content =
        \\export SERVER_PORT: 8080
        \\export HOST: localhost
        \\URL=http://${HOST}:${SERVER_PORT}
        \\TIMEOUT=${TIMEOUT_MS:-5000}
    ;

    var env = try zigenv.parseStringWithOptions(allocator, content, opts, null, null);
    defer env.deinit();

    try testing.expectEqualStrings("8080", env.get("SERVER_PORT").?);
    try testing.expectEqualStrings("localhost", env.get("HOST").?);
    try testing.expectEqualStrings("http://localhost:8080", env.get("URL").?);
    try testing.expectEqualStrings("5000", env.get("TIMEOUT").?);
}

test "Bun Integration: whitespace in interpolation" {
    const allocator = testing.allocator;
    const content =
        \\VAR=value
        \\A=${ VAR }
        \\B=${  VAR  }
        \\C=${VAR       }
        \\D=${       VAR}
        \\MISSING=${  UNKNOWN  :-  default  }
    ;

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("value", env.get("A").?);
    try testing.expectEqualStrings("value", env.get("B").?);
    try testing.expectEqualStrings("value", env.get("C").?);
    try testing.expectEqualStrings("value", env.get("D").?);
    try testing.expectEqualStrings("  default  ", env.get("MISSING").?); // Defaults might preserve whitespace in value part?
}
