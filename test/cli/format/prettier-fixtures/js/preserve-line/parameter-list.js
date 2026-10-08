class Foo {
  constructor(
    one,

    two,
    three,
    four,


    five,
    six,
    seven,
    eight,
    nine,
    ten,

    eleven

  ) {}
}

function foo(
  one,

  two,
  three,
  four,


  five,
  six,
  seven,
  eight,
  nine,
  ten,

  eleven

) {}

call((a, b) => {});

call((
  one,
  two,
  three,
  four,
  five,
  six,
  seven,
  eight,
  nine,
  ten,
  eleven
) => {});

call((
  one,

  two,
  three,
  four,


  five,
  six,
  seven,
  eight,
  nine,
  ten,

  eleven

) => {});

function test({
  one,

  two,
  three,
  four,


  five,
  six,
  seven,
  eight,
  nine,
  ten,

  eleven

}) {}

function test({
  one,
  two,
  three,
  four,
}) {}

function test({
  one,

  two,
  three,
  four,

}) {}

function test({ one, two, three, four }, $a) {}


function test(
  { one, two, three, four },

  $a
) {}

function foo(

  ...rest

) {}

function foo(
  one,

  ...rest
) {}

function foo(one,...rest) {}

f(
  superSuperSuperSuperSuperSuperSuperSuperSuperSuperSuperSuperSuperSuperLong,...args
);

it(

  "does something really long and complicated so I have to write a very long name for the test",

  function(

    done,

    foo
  ) {

    console.log("hello!");
  }
);
