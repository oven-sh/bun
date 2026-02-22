const std = @import("std");
const zigenv = @import("zigenv");
const testing = std.testing;

test "file based: nodejs project" {
    const allocator = testing.allocator;

    var env = try zigenv.parseFile(allocator, "tests/fixtures/nodejs_project.env");
    defer env.deinit();

    // Verify expected keys exist
    _ = env.get("NODE_ENV").?;
    _ = env.get("PORT").?;
    _ = env.get("DATABASE_URL").?;
    _ = env.get("API_KEY").?;

    // Verify interpolation works
    const secret_key = env.get("SECRET_KEY").?;
    try testing.expect(std.mem.indexOf(u8, secret_key, "sk-1234567890abcdef") != null);
    try testing.expect(std.mem.indexOf(u8, secret_key, "production") != null);
}

test "file based: django project" {
    const allocator = testing.allocator;

    var env = try zigenv.parseFile(allocator, "tests/fixtures/django_project.env");
    defer env.deinit();

    // Verify expected keys
    _ = env.get("DEBUG").?;
    _ = env.get("SECRET_KEY").?;
    _ = env.get("DATABASE_URL").?;
    _ = env.get("ALLOWED_HOSTS").?;
}

test "file based: docker compose" {
    const allocator = testing.allocator;

    var env = try zigenv.parseFile(allocator, "tests/fixtures/docker_compose.env");
    defer env.deinit();

    // Verify Docker environment variables
    const postgres_user = env.get("POSTGRES_USER").?;
    try testing.expectEqualStrings("admin", postgres_user);

    const postgres_db = env.get("POSTGRES_DB").?;
    try testing.expectEqualStrings("myapp", postgres_db);
}

test "file based: ci/cd configuration" {
    const allocator = testing.allocator;

    var env = try zigenv.parseFile(allocator, "tests/fixtures/ci_cd_config.env");
    defer env.deinit();

    // Verify CI variables
    const ci = env.get("CI").?;
    try testing.expectEqualStrings("true", ci);

    _ = env.get("BUILD_NUMBER").?;
    _ = env.get("AWS_REGION").?;
}

test "file based: kitchen sink - all features" {
    const allocator = testing.allocator;

    var env = try zigenv.parseFile(allocator, "tests/fixtures/kitchen_sink.env");
    defer env.deinit();

    // Verify various features
    _ = env.get("SIMPLE").?;
    const empty = env.get("EMPTY").?;
    try testing.expectEqualStrings("", empty);
    _ = env.get("QUOTED").?;
    _ = env.get("SINGLE").?;
}

test "file based: complex interpolation" {
    const allocator = testing.allocator;

    var env = try zigenv.parseFile(allocator, "tests/fixtures/complex_interpolation.env");
    defer env.deinit();

    // Verify nested interpolations work
    const full_url = env.get("FULL_URL").?;
    try testing.expect(std.mem.indexOf(u8, full_url, "api.example.com") != null);
    try testing.expect(std.mem.indexOf(u8, full_url, "v2") != null);
    try testing.expect(std.mem.indexOf(u8, full_url, "user123") != null);

    const db_connection = env.get("DB_CONNECTION").?;
    try testing.expect(std.mem.indexOf(u8, db_connection, "postgresql") != null);
    try testing.expect(std.mem.indexOf(u8, db_connection, "admin") != null);
    try testing.expect(std.mem.indexOf(u8, db_connection, "5432") != null);
}

test "file based: large file 10k entries" {
    const allocator = testing.allocator;

    var env = try zigenv.parseFile(allocator, "tests/fixtures/large_10k.env");
    defer env.deinit();

    // Should have at least 10,000 entries
    try testing.expect(env.map.count() >= 10000);

    // Spot check some entries
    const first = env.get("KEY_00000").?;
    try testing.expectEqualStrings("value_0_data", first);

    const middle = env.get("KEY_05000").?;
    try testing.expectEqualStrings("value_5000_data", middle);

    const last = env.get("KEY_09999").?;
    try testing.expectEqualStrings("value_9999_data", last);
}

test "file based: empty file" {
    const allocator = testing.allocator;

    var env = try zigenv.parseFile(allocator, "tests/fixtures/empty.env");
    defer env.deinit();

    // Empty file should parse successfully with zero pairs
    try testing.expectEqual(@as(usize, 0), env.map.count());
}

test "file based: only comments" {
    const allocator = testing.allocator;

    var env = try zigenv.parseFile(allocator, "tests/fixtures/only_comments.env");
    defer env.deinit();

    // File with only comments should have zero pairs
    try testing.expectEqual(@as(usize, 0), env.map.count());
}

test "file based: windows paths" {
    const allocator = testing.allocator;

    var env = try zigenv.parseFile(allocator, "tests/fixtures/windows_paths.env");
    defer env.deinit();

    // Verify Windows path handling
    const app_path = env.get("APP_PATH").?;
    try testing.expect(std.mem.indexOf(u8, app_path, "C:") != null);
    try testing.expect(std.mem.indexOf(u8, app_path, "Users") != null);

    const unc_share = env.get("UNC_SHARE").?;
    try testing.expect(std.mem.indexOf(u8, unc_share, "\\\\server") != null);
}

test "file based: unicode content" {
    const allocator = testing.allocator;

    var env = try zigenv.parseFile(allocator, "tests/fixtures/unicode_content.env");
    defer env.deinit();

    // Verify Unicode handling
    _ = env.get("EMOJI_KEY").?;
    _ = env.get("JAPANESE").?;
    _ = env.get("ARABIC").?;
    _ = env.get("HEBREW").?;
    _ = env.get("CHINESE").?;
    _ = env.get("KOREAN").?;

    // Verify values contain Unicode characters
    const japanese_value = env.get("JAPANESE_VALUE").?;
    try testing.expect(japanese_value.len > 0);
}
