const std = @import("std");
const zigenv = @import("zigenv");
const testing = std.testing;

test "unicode: emoji in keys" {
    const allocator = testing.allocator;
    const content = "🔑=value";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("🔑").?;
    try testing.expectEqualStrings("value", value);
}

test "unicode: emoji in values" {
    const allocator = testing.allocator;
    const content = "KEY=🎉";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("KEY").?;
    try testing.expectEqualStrings("🎉", value);
}

test "unicode: japanese characters" {
    const allocator = testing.allocator;
    const content = "日本語=こんにちは";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("日本語").?;
    try testing.expectEqualStrings("こんにちは", value);
}

test "unicode: chinese characters" {
    const allocator = testing.allocator;
    const content = "中文=你好";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("中文").?;
    try testing.expectEqualStrings("你好", value);
}

test "unicode: korean characters" {
    const allocator = testing.allocator;
    const content = "한국어=안녕하세요";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("한국어").?;
    try testing.expectEqualStrings("안녕하세요", value);
}

test "unicode: arabic characters (RTL)" {
    const allocator = testing.allocator;
    const content = "مفتاح=قيمة";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("مفتاح").?;
    try testing.expectEqualStrings("قيمة", value);
}

test "unicode: hebrew characters (RTL)" {
    const allocator = testing.allocator;
    const content = "מפתח=ערך";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("מפתח").?;
    try testing.expectEqualStrings("ערך", value);
}

test "unicode: russian cyrillic" {
    const allocator = testing.allocator;
    const content = "Ключ=Значение";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("Ключ").?;
    try testing.expectEqualStrings("Значение", value);
}

test "unicode: thai characters" {
    const allocator = testing.allocator;
    const content = "คีย์=ค่า";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("คีย์").?;
    try testing.expectEqualStrings("ค่า", value);
}

test "unicode: mixed scripts in value" {
    const allocator = testing.allocator;
    const content = "KEY=Hello世界🌍مرحبا";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("KEY").?;
    try testing.expect(std.mem.indexOf(u8, value, "Hello") != null);
    try testing.expect(std.mem.indexOf(u8, value, "🌍") != null);
}

test "unicode: combining characters" {
    const allocator = testing.allocator;
    // café with combining accent vs precomposed
    const content = "KEY=café";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("KEY").?;
    try testing.expect(value.len > 0);
}

test "unicode: emoji with modifiers" {
    const allocator = testing.allocator;
    const content = "KEY=👨‍👩‍👧‍👦"; // Family emoji with ZWJ

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("KEY").?;
    try testing.expect(value.len > 0);
}

test "unicode: various emoji categories" {
    const allocator = testing.allocator;
    const content =
        \\SMILEYS=😀😃😄😁
        \\ANIMALS=🐶🐱🐭🐹
        \\FOOD=🍕🍔🍟🌮
    ;

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    _ = env.get("SMILEYS").?;
    _ = env.get("ANIMALS").?;
    _ = env.get("FOOD").?;
}

test "unicode: mathematical symbols" {
    const allocator = testing.allocator;
    const content = "MATH=∑∏∫∂∞";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("MATH").?;
    try testing.expect(value.len > 0);
}

test "unicode: currency symbols" {
    const allocator = testing.allocator;
    const content = "CURRENCIES=€¥£₹₽";

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const value = env.get("CURRENCIES").?;
    try testing.expect(value.len > 0);
}

test "unicode: interpolation with unicode" {
    const allocator = testing.allocator;
    const content =
        \\BASE=世界
        \\GREETING=Hello ${BASE}!
    ;

    var env = try zigenv.parseString(allocator, content);
    defer env.deinit();

    const greeting = env.get("GREETING").?;
    try testing.expect(std.mem.indexOf(u8, greeting, "Hello") != null);
    try testing.expect(std.mem.indexOf(u8, greeting, "世界") != null);
}
