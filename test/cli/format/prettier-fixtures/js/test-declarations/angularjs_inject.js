beforeEach(inject(($fooService, $barService) => {
  // code
}));

afterAll(inject(($fooService, $barService) => {
  console.log('Hello');
}));

it('should create the app', inject(($fooService, $barService) => {
  //code
}));

it("does something really long and complicated so I have to write a very long name for the test", inject(() => {
  // code
}));

it("does something really long and complicated so I have to write a very long name for the test", inject(($fooServiceLongName, $barServiceLongName) => {
  // code
}));

/*
* isTestCall(parent) should only be called when parent exists
* and parent.type is CallExpression. This test makes sure that
* no errors are thrown when calling isTestCall(parent)
*/
function x() { inject(() => {}) }
