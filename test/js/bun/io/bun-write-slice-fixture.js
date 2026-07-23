const [, , src, dst, start, end] = process.argv;
await Bun.write(Bun.file(dst), Bun.file(src).slice(Number(start), Number(end)));
