test("1", async () => {
  const x = jest.fn(() => 1);

  console.log("3", x());

  await x.withImplementation(
    () => 2,
    async () => {
      console.log("2", x());
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log("2", x());
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log("2", x());
    },
  );

  console.log("3", x());
});
