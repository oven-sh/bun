console.log("--- begin ---");
console.log({
  a: "a",
  multiline: 'pub fn main() !void {\n    std.log.info("Hello, {s}", .{name});\n}',
  error: new Error("Hello, world!"),
});
console.log("--- end ---");
