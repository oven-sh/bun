import assert from "assert";

// ensure process.argv and Bun.argv are the same
assert.deepStrictEqual(process.argv, Bun.argv, "process.argv does not equal Bun.argv");
assert(process.argv === process.argv, "process.argv isn't cached");
assert(Bun.argv === Bun.argv, "Bun.argv isn't cached");
// assert(Bun.argv === process.argv, "Bun.argv doesnt share same ref as process.argv");

var writer = Bun.stdout.writer();
writer.write(JSON.stringify(process.argv));
await writer.flush(true);
process.exit(0);
