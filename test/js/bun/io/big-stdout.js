const str = "a".repeat(300000);
await Bun.write(Bun.stdout, str);
