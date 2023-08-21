await Bun.write(Bun.file(process.argv.at(-2)), Bun.file(process.argv.at(-1)));
