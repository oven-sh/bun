var writer = Bun.stdout.writer()
writer.write(JSON.stringify(process.argv));
await writer.flush(true);
process.exit(0);