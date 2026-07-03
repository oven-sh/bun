// Web IDL: `new TextDecoderStream(label, options)` treats undefined/null options as {}.
test("TextDecoderStream accepts undefined and null options", () => {
  for (const options of [undefined, null]) {
    const stream = new TextDecoderStream("utf-8", options);
    expect(stream.fatal).toBe(false);
    expect(stream.ignoreBOM).toBe(false);
  }
  expect(new TextDecoderStream("utf-8", { fatal: true }).fatal).toBe(true);
});
