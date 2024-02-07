for (let i = 0; i <= 20; i++) {
  await Bun.write(Bun.stderr, i + "\n");
  await new Promise(r => setTimeout(r, 100));
}
