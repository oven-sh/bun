const std = @import("std");
const zigenv = @import("zigenv");
const testing = std.testing;
const ManagedList = zigenv.ManagedList;

test "fuzz: random byte sequences (100 iterations)" {
    const allocator = testing.allocator;
    var prng = std.Random.DefaultPrng.init(42);
    const random = prng.random();

    var i: usize = 0;
    while (i < 100) : (i += 1) {
        var buffer: [1024]u8 = undefined;
        random.bytes(&buffer);

        // Should not crash, even on garbage input
        if (zigenv.parseString(allocator, &buffer)) |env_result| {
            var env = env_result;
            env.deinit();
        } else |_| {
            // Expected to fail
        }
    }
}

test "fuzz: random printable ASCII (100 iterations)" {
    const allocator = testing.allocator;
    var prng = std.Random.DefaultPrng.init(43);
    const random = prng.random();

    var i: usize = 0;
    while (i < 100) : (i += 1) {
        var buffer: [512]u8 = undefined;
        for (&buffer) |*byte| {
            byte.* = 32 + random.intRangeAtMost(u8, 0, 94); // Printable ASCII
        }

        if (zigenv.parseString(allocator, &buffer)) |env_result| {
            var env = env_result;
            env.deinit();
        } else |_| {
            // Expected
        }
    }
}

test "fuzz: mutation based from valid input" {
    const allocator = testing.allocator;
    var prng = std.Random.DefaultPrng.init(44);
    const random = prng.random();

    const base_content = "KEY=value\nOTHER=data\nTHIRD=test";

    var i: usize = 0;
    while (i < 50) : (i += 1) {
        var buffer: [256]u8 = undefined;
        @memcpy(buffer[0..base_content.len], base_content);

        // Randomly mutate a few bytes
        var j: usize = 0;
        while (j < 5) : (j += 1) {
            const pos = random.intRangeAtMost(usize, 0, base_content.len - 1);
            buffer[pos] = random.int(u8);
        }

        if (zigenv.parseString(allocator, buffer[0..base_content.len])) |env_result| {
            var env = env_result;
            env.deinit();
        } else |_| {
            // Expected
        }
    }
}

test "fuzz: random key-value structure" {
    const allocator = testing.allocator;
    var prng = std.Random.DefaultPrng.init(45);
    const random = prng.random();

    var content = ManagedList(u8).init(allocator);
    defer content.deinit();

    var i: usize = 0;
    while (i < 20) : (i += 1) {
        content.clearRetainingCapacity();

        // Generate random pairs
        const pair_count: usize = random.intRangeAtMost(usize, 1, 10);
        var p: usize = 0;
        while (p < pair_count) : (p += 1) {
            const key_len = random.intRangeAtMost(usize, 1, 20);
            const val_len = random.intRangeAtMost(usize, 0, 30);

            // Random key
            var k: usize = 0;
            while (k < key_len) : (k += 1) {
                const ch = random.intRangeAtMost(u8, 'A', 'Z');
                try content.append(ch);
            }

            try content.append('=');

            // Random value
            var v: usize = 0;
            while (v < val_len) : (v += 1) {
                const ch = random.intRangeAtMost(u8, 32, 126);
                try content.append(ch);
            }

            try content.append('\n');
        }

        if (zigenv.parseString(allocator, content.list.items)) |env_result| {
            var env = env_result;
            env.deinit();
        } else |_| {
            // Expected
        }
    }
}

test "fuzz: random quote patterns" {
    const allocator = testing.allocator;
    var prng = std.Random.DefaultPrng.init(46);
    const random = prng.random();

    const quotes = [_]u8{ '"', '\'', '`' };

    var i: usize = 0;
    while (i < 50) : (i += 1) {
        var content = ManagedList(u8).init(allocator);
        defer content.deinit();

        try content.appendSlice("KEY=");

        // Random quote type
        const quote = quotes[random.intRangeAtMost(usize, 0, quotes.len - 1)];
        try content.append(quote);

        // Random content
        const content_len = random.intRangeAtMost(usize, 0, 20);
        var j: usize = 0;
        while (j < content_len) : (j += 1) {
            try content.append(random.intRangeAtMost(u8, 'a', 'z'));
        }

        // Maybe close quote
        if (random.boolean()) {
            try content.append(quote);
        }

        if (zigenv.parseString(allocator, content.list.items)) |env_result| {
            var env = env_result;
            env.deinit();
        } else |_| {
            // Expected
        }
    }
}
