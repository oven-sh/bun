const writer = Bun.file("written.txt").writer();
writer.write("one ");
writer.write(new TextEncoder().encode("two "));
await writer.flush();
writer.write("three");
console.log(await writer.end(), await Bun.file("written.txt").text());
await Bun.file("written.txt").delete();
