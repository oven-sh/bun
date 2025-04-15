jest.setTimeout(5);

it("fails when cb is never called", done => {
  // nada
});

it("fails when cb is called after timeout", done => {
  setTimeout(done, 1000);
});
