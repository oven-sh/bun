const std = @import("std");
const testing = std.testing;
const zigenv = @import("zigenv");
const EnvPairList = zigenv.EnvPairList;
const EnvPair = zigenv.EnvPair;
const VariablePositionList = zigenv.VariablePositionList;
const VariablePosition = zigenv.VariablePosition;
const ManagedList = zigenv.ManagedList;

test "EnvPairList lifecycle and capacity" {
    const allocator = testing.allocator;
    var list = EnvPairList.init(allocator);
    defer list.deinit();

    // Initial state
    try testing.expectEqual(@as(usize, 0), list.items.len);
    try testing.expectEqual(@as(usize, 0), list.capacity);

    // Grow capacity
    try list.ensureTotalCapacity(4);
    try testing.expect(list.capacity >= 4);
    try testing.expectEqual(@as(usize, 0), list.items.len);

    // Append items
    var pair1 = EnvPair.init(allocator);
    pair1.key.setOwnBuffer(try allocator.dupe(u8, "KEY1"));
    try list.append(pair1);

    try testing.expectEqual(@as(usize, 1), list.items.len);
    try testing.expectEqualStrings("KEY1", list.items[0].key.key());

    // Force growth
    const initial_capacity = list.capacity;

    var pair2 = EnvPair.init(allocator);
    pair2.key.setOwnBuffer(try allocator.dupe(u8, "KEY2"));
    try list.append(pair2);

    // Clear keeping capacity
    list.clearRetainingCapacity();
    try testing.expectEqual(@as(usize, 0), list.items.len);
    try testing.expectEqual(initial_capacity, list.capacity);

    // Ensure memory is reusable
    var pair3 = EnvPair.init(allocator);
    pair3.key.setOwnBuffer(try allocator.dupe(u8, "KEY3"));
    try list.append(pair3);
    try testing.expectEqual(@as(usize, 1), list.items.len);
    try testing.expectEqualStrings("KEY3", list.items[0].key.key());
}

test "VariablePositionList - orderedRemove" {
    const allocator = testing.allocator;
    var list = VariablePositionList.init(allocator);
    defer list.deinit();

    try list.append(VariablePosition.init(0, 1, 10)); // Index 0
    try list.append(VariablePosition.init(1, 2, 20)); // Index 1
    try list.append(VariablePosition.init(2, 3, 30)); // Index 2
    try list.append(VariablePosition.init(3, 4, 40)); // Index 3

    try testing.expectEqual(@as(usize, 4), list.items.len);

    // Remove from middle (Index 1)
    const removed = list.orderedRemove(1);
    try testing.expectEqual(removed.variable_start, 1);

    // Verify order
    try testing.expectEqual(@as(usize, 3), list.items.len);
    try testing.expectEqual(@as(usize, 0), list.items[0].variable_start);
    try testing.expectEqual(@as(usize, 2), list.items[1].variable_start); // shifted
    try testing.expectEqual(@as(usize, 3), list.items[2].variable_start); // shifted

    // Remove from end
    const last = list.orderedRemove(2);
    try testing.expectEqual(last.variable_start, 3);
    try testing.expectEqual(@as(usize, 2), list.items.len);

    // Remove from start
    const first = list.orderedRemove(0);
    try testing.expectEqual(first.variable_start, 0);
    try testing.expectEqual(@as(usize, 1), list.items.len);
    try testing.expectEqual(@as(usize, 2), list.items[0].variable_start);
}

test "VariablePositionList lifecycle" {
    const allocator = testing.allocator;
    var list = VariablePositionList.init(allocator);
    defer list.deinit();

    var pos = VariablePosition.init(0, 1, 2);
    // VariablePosition might manage memory for variable_str
    try pos.setVariableStr(allocator, "VAR");
    try list.append(pos);

    try testing.expectEqual(@as(usize, 1), list.items.len);

    // clearRetainingCapacity should free the strings inside VariablePosition
    // We can't easily test that it freed memory without a leak detector,
    // but we can verify the list is empty.
    list.clearRetainingCapacity();
    try testing.expectEqual(@as(usize, 0), list.items.len);
    try testing.expect(list.capacity > 0);
}

test "ManagedList usage" {
    const allocator = testing.allocator;
    const MyManagedList = ManagedList(u32);
    var list = MyManagedList.init(allocator);
    defer list.deinit();

    try list.append(10);
    try list.append(20);
    try list.appendSlice(&[_]u32{ 30, 40 });

    try testing.expectEqual(@as(usize, 4), list.list.items.len);
    try testing.expectEqual(@as(u32, 10), list.list.items[0]);
    try testing.expectEqual(@as(u32, 40), list.list.items[3]);

    list.clearRetainingCapacity();
    try testing.expectEqual(@as(usize, 0), list.list.items.len);
}
