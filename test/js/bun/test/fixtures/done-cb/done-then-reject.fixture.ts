test("calling done then rejecting", done => {
  done();
  return Promise.reject(new Error("error message from test"));
});
