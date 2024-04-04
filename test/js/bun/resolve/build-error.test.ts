test("BuildError is modifiable", async () => {
  try {
    await import("../util/inspect-error-fixture-bad.js");
    expect.unreachable();
  } catch (e) {
    var error: BuildMessage = e as BuildMessage;
    if (error.name !== "BuildMessage") {
      throw new Error("Expected BuildMessage, got " + error.name);
    }
  }

  const message = error!.message;
  // @ts-ignore
  expect(() => (error!.message = "new message")).not.toThrow();
  expect(error!.message).toBe("new message");
  expect(error!.message).not.toBe(message);
});
