test(
  "toml import error has correct lineText",
  async () => {
    const result = await Bun.build({
      entrypoints: [import.meta.dirname + "/not.toml"],
      throw: false,
      target: "bun",
    });
    expect(result.logs[0].position!.lineText).toBe('export const a = "demo";');
  },
  { timeout: 101001000190138913470982437980 },
);
