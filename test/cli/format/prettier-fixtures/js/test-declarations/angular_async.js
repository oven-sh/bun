beforeEach(async(() => {
  // code
}));

beforeEach(done =>
  foo()
    .bar()
    .bar(),
);

afterAll(async(() => {
  console.log('Hello');
}));

afterAll(done =>
  foo()
    .bar()
    .bar(),
);

it('should create the app', async(() => {
  //code
}));

it("does something really long and complicated so I have to write a very long name for the test", async(() => {
  // code
}));

/*
* isTestCall(parent) should only be called when parent exists
* and parent.type is CallExpression. This test makes sure that
* no errors are thrown when calling isTestCall(parent)
*/
function x() { async(() => {}) }
