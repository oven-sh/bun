beforeEach(fakeAsync(() => {
  // code
}));

afterAll(fakeAsync(() => {
  console.log('Hello');
}));

it('should create the app', fakeAsync(() => {
  //code
}));

it("does something really long and complicated so I have to write a very long name for the test", fakeAsync(() => {
  // code
}));

it("does something really long and complicated so I have to write a very long name for the test", fakeAsync(() => new SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS));

/*
* isTestCall(parent) should only be called when parent exists
* and parent.type is CallExpression. This test makes sure that
* no errors are thrown when calling isTestCall(parent)
*/
function x() { fakeAsync(() => {}) }
