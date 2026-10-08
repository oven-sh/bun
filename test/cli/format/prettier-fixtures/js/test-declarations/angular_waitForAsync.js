beforeEach(waitForAsync(() => {
  // code
}));

afterAll(waitForAsync(() => {
  console.log('Hello');
}));

it('should create the app', waitForAsync(() => {
  //code
}));

it("does something really long and complicated so I have to write a very long name for the test", waitForAsync(() => {
  // code
}));

it("does something really long and complicated so I have to write a very long name for the test", waitForAsync(() => new SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS));

/*
* isTestCall(parent) should only be called when parent exists
* and parent.type is CallExpression. This test makes sure that
* no errors are thrown when calling isTestCall(parent)
*/
function x() { waitForAsync(() => {}) }
