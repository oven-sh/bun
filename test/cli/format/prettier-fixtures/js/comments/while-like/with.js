with(
    foo
    // 1
  ) {}

with(foo)// 2
{}

with(foo)
// 22
{}

with(foo){}// 3

with(foo)/*4*/{}

with(
  foo // 5
  ?? bar // 52
  ){}

with(foo) {} // 6

with(foo) /* 7 */ ++x;

with(1) // 8
  foo();

with (0) {// comment
}

with (0) {
  // comment
}

with (0) {/* comment */}

with ((0, 0/* comment */)) {}
