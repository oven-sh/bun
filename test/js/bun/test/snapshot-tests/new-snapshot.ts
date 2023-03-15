test("new snapshot", () => {
  expect({ b: 2 }).toMatchSnapshot();
});
