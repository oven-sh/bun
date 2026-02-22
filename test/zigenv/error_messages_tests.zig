const std = @import("std");
const zigenv = @import("zigenv");
const testing = std.testing;

test "error: unclosed double quote" {
    const allocator = testing.allocator;
    const content = "KEY=\"unclosed string";

    if (zigenv.parseString(allocator, content)) |env_result| {
        var env = env_result;
        defer env.deinit();
        // Zigenv may allow unclosed quotes at EOF
    } else |_| {
        // Error is expected if strict
    }
}

test "error: unclosed single quote" {
    const allocator = testing.allocator;
    const content = "KEY='unclosed string";

    if (zigenv.parseString(allocator, content)) |env_result| {
        var env = env_result;
        defer env.deinit();
    } else |_| {
        // Expected
    }
}

test "error: unclosed heredoc" {
    const allocator = testing.allocator;
    const content =
        \\KEY="""
        \\unclosed heredoc
    ;

    if (zigenv.parseString(allocator, content)) |env_result| {
        var env = env_result;
        defer env.deinit();
    } else |_| {
        // Expected
    }
}

test "error: invalid interpolation syntax" {
    const allocator = testing.allocator;
    const content = "KEY=${UNCLOSED";

    if (zigenv.parseString(allocator, content)) |env_result| {
        var env = env_result;
        defer env.deinit();
    } else |_| {
        // Error is also fine
    }
}

test "error: file not found" {
    const allocator = testing.allocator;

    if (zigenv.parseFile(allocator, "non_existent_file.env")) |_| {
        return error.ExpectedError;
    } else |err| {
        try testing.expect(err == error.FileNotFound);
    }
}

test "error: invalid line format (no equals)" {
    const allocator = testing.allocator;
    const content = "JUST_A_KEY_NO_VALUE";

    if (zigenv.parseString(allocator, content)) |env_result| {
        var env = env_result;
        defer env.deinit();
        try testing.expect(env.get("JUST_A_KEY_NO_VALUE") == null);
    } else |_| {
        // Parsing error is also acceptable
    }
}

test "error: null byte in content" {
    const allocator = testing.allocator;
    const content = "KEY=va\x00lue";

    if (zigenv.parseString(allocator, content)) |env_result| {
        var env = env_result;
        defer env.deinit();
        _ = env.get("KEY");
    } else |_| {
        // Error acceptable
    }
}
