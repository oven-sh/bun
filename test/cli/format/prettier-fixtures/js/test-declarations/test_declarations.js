// Shouldn't break

it("does something really long and complicated so I have to write a very long name for the test", () => {
  console.log("hello!");
});

it("does something really long and complicated so I have to write a very long name for the test", function() {
  console.log("hello!");
});

it("does something really long and complicated so I have to write a very long name for the test", function(done) {
  console.log("hello!");
});

it("does something really long and complicated so I have to write a very long name for the test", function myAssertions(done) {
  console.log("hello!");
});

it(`does something really long and complicated so I have to write a very long name for the test`, function() {
  console.log("hello!");
});

it(`{foo + bar} does something really long and complicated so I have to write a very long name for the test`, function() {
  console.log("hello!");
});

it(`handles
  some
    newlines
  does something really long and complicated so I have to write a very long name for the test`, () => {
  console.log("hello!");
})

test("does something really long and complicated so I have to write a very long name for the test", (done) => {
  console.log("hello!");
});

test(`does something really long and complicated so I have to write a very long name for the test`, (done) => {
  console.log("hello!");
});

describe("does something really long and complicated so I have to write a very long name for the describe block", () => {
  it("an example test", (done) => {
    console.log("hello!");
  });
});

describe(`does something really long and complicated so I have to write a very long name for the describe block`, () => {
  it(`an example test`, (done) => {
    console.log("hello!");
  });
});

xdescribe("does something really long and complicated so I have to write a very long name for the describe block", () => {});

fdescribe("does something really long and complicated so I have to write a very long name for the describe block", () => {});

describe.only(`does something really long and complicated so I have to write a very long name for the test`, () => {});

describe.skip(`does something really long and complicated so I have to write a very long name for the test`, () => {});

fit("does something really long and complicated so I have to write a very long name for the describe block", () => {});

xit("does something really long and complicated so I have to write a very long name for the describe block", () => {});

it.only("does something really long and complicated so I have to write a very long name for the test", () => {
  console.log("hello!");
});

it.only(`does something really long and complicated so I have to write a very long name for the test`, () => {
  console.log("hello!");
});

it.skip(`does something really long and complicated so I have to write a very long name for the test`, () => {});

test.only(`does something really long and complicated so I have to write a very long name for the test`, () => {});

test.skip(`does something really long and complicated so I have to write a very long name for the test`, () => {});

test.fixme(`does something really long and complicated so I have to write a very long name for the test`, () => {});

ftest("does something really long and complicated so I have to write a very long name for the describe block", () => {});

xtest("does something really long and complicated so I have to write a very long name for the describe block", () => {});

skip(`does something really long and complicated so I have to write a very long name for the test`, () => {});

skip("does something really long and complicated so I have to write a very long name for the test", () => {});

test.step("does something really long and complicated so I have to write a very long name for the test", () => {});

test.step(`does something really long and complicated so I have to write a very long name for the test`, () => {});

test.describe("does something really long and complicated so I have to write a very long name for the test", () => {});

test.describe(`does something really long and complicated so I have to write a very long name for the test`, () => {});

test.describe.only("does something really long and complicated so I have to write a very long name for the test", () => {});

test.describe.skip("does something really long and complicated so I have to write a very long name for the test", () => {});

test.describe.fixme("does something really long and complicated so I have to write a very long name for the test", () => {});

test.describe.only(`does something really long and complicated so I have to write a very long name for the test`, () => {});

test.describe.parallel("does something really long and complicated so I have to write a very long name for the test", () => {});

test.describe.parallel(`does something really long and complicated so I have to write a very long name for the test`, () => {});

test.describe.parallel.only("does something really long and complicated so I have to write a very long name for the testThis is a very", () => {});

test.describe.parallel.only(`does something really long and complicated so I have to write a very long name for the testThis is a very`, () => {});

test.describe.serial("does something really long and complicated so I have to write a very long name for the test", () => {});

test.describe.serial(`does something really long and complicated so I have to write a very long name for the test`, () => {});

test.describe.serial.only("does something really long and complicated so I have to write a very long name for the test", () => {});

test.describe.serial.only(`does something really long and complicated so I have to write a very long name for the test`, () => {});

// Should break

it.only("does something really long and complicated so I have to write a very long name for the test", 10, () => {
  console.log("hello!");
});

it.only.only("does something really long and complicated so I have to write a very long name for the test", () => {
  console.log("hello!");
});

it.only.only("does something really long and complicated so I have to write a very long name for the test", (a, b, c) => {
  console.log("hello!");
});

xskip("does something really long and complicated so I have to write a very long name for the test", () => {});

test.describe.only.parallel("does something really long and complicated so I have to write a very long name for the test", () => {});

test.describe.parallel.serial("does something really long and complicated so I have to write a very long name for the testThis is a very", () => {});

test.serial("does something really long and complicated so I have to write a very long name for the test", () => {});

test.describe.dummy.serial("does something really long and complicated so I have to write a very long name for the test", () => {});

// timeout

it(`handles
  some
    newlines
  does something really long and complicated so I have to write a very long name for the test`, () => {
  console.log("hello!");
}, 2500)

it("does something quick", () => {
  console.log("hello!")
}, 1000000000)

it(
  'succeeds if the test finishes in time',
  () => new Promise(resolve => setTimeout(resolve, 10))
);

it(
  'succeeds if the test finishes in time',
  () => new Promise(resolve => setTimeout(resolve, 10)),
  250
);
