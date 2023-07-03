test("we can go back in time", () => {
  const dateNow = Date.now;
  //   jest.useFakeTimers();
  jest.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
  expect(new Date().toISOString()).toBe("2020-01-01T00:00:00.000Z");
  expect(Date.now()).toBe(1577836800000);
  expect(dateNow).toBe(Date.now);

  jest.setSystemTime();
  expect(new Date().toISOString()).not.toBe("2020-01-01T00:00:00.000Z");
});
