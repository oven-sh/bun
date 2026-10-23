console.log(typeof Bun.secrets.get, typeof Bun.secrets.set, typeof Bun.secrets.delete);
try {
  await (Bun.secrets.get as any)({});
} catch (error) {
  console.log((error as Error).name, (error as { code?: string }).code);
}
