const std = @import("std");
const testing = std.testing;
const lib = @import("zigenv");

test "single quoted with garbage" {
    const allocator = testing.allocator;

    const content =
        \\a='\\t ${b}' asdfasdf
        \\b='' asdfasdf
    ;

    var env = try lib.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqual(@as(u32, 2), env.map.count());
    try testing.expectEqualStrings("\\\\t ${b}", env.get("a").?);
    try testing.expectEqualStrings("", env.get("b").?);
}

test "single quoted with more garbage" {
    const allocator = testing.allocator;

    const content =
        \\a='\\t ${b}' asdfasdf
        \\b='' asdfasdf
        \\c='a' asdfasdf
        \\# blah
        \\
        \\f='# fek' garfa
    ;

    var env = try lib.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqual(@as(u32, 4), env.map.count());
    try testing.expectEqualStrings("\\\\t ${b}", env.get("a").?);
    try testing.expectEqualStrings("", env.get("b").?);
    try testing.expectEqualStrings("a", env.get("c").?);
    try testing.expectEqualStrings("# fek", env.get("f").?);
}

test "double quoted heredoc with garbage" {
    const allocator = testing.allocator;

    const content =
        \\b=1
        \\a="""
        \\\t
        \\${b}
        \\""" abc
        \\c="""def""" asldkljasdfl;kj
    ;

    var env = try lib.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqual(@as(u32, 3), env.map.count());
    // a starts after first """ with a newline, then a tab, then another newline, then 1, then another newline.
    try testing.expectEqualStrings("\n\t\n1\n", env.get("a").?);
    try testing.expectEqualStrings("def", env.get("c").?);
}

test "heredoc double quote unclosed" {
    const allocator = testing.allocator;

    // In C++, the sample was:
    // a="""
    // heredoc
    // """
    // b=${a}
    // c=""" $ {b }

    const content =
        \\a="""
        \\heredoc
        \\"""
        \\b=${a}
        \\c=""" $ {b }
    ;

    var env = try lib.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqual(@as(u32, 3), env.map.count());
    try testing.expectEqualStrings("\nheredoc\n", env.get("a").?);
    try testing.expectEqualStrings("\nheredoc\n", env.get("b").?);
    // c is finalized to the value of b because $ {b } matches b.
    // The leading space in """ $ {b } is preserved.
    try testing.expectEqualStrings(" \nheredoc\n", env.get("c").?);
}

test "Heredoc with Comment" {
    const allocator = testing.allocator;

    const content =
        \\message="""Greetings
        \\...
        \\""" #k
        \\cc_message="${message}"
    ;

    var env = try lib.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("Greetings\n...\n", env.get("message").?);
    try testing.expectEqualStrings("Greetings\n...\n", env.get("cc_message").?);
}

test "DoubleQuotedHereDoc3 variations" {
    const allocator = testing.allocator;

    const content =
        \\a="""
        \\foo
        \\"""bar
        \\b="""
        \\baz
        \\""" # comment
    ;

    var env = try lib.parseString(allocator, content);
    defer env.deinit();

    try testing.expectEqualStrings("\nfoo\n", env.get("a").?);
    try testing.expectEqualStrings("\nbaz\n", env.get("b").?);
}
