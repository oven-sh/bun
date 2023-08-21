await Bun.write(Bun.file(process.argv.at(-1)), Bun.file(process.argv.at(-2)));
