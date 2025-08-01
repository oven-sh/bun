describe(".toThrow()", () => {
  it(".toThrow() behaves the same as .toThrow('')", () => {
    expect(() => {
      throw new Error("test");
    }).toThrow();

    expect(() => {
      throw new Error("test");
    }).toThrow("");
  });
});
