while(
    true
    // 1
  ) {}

while(true)// 2
{}

while(true)
// 22
{}

while(true){}// 3

while(true)/*4*/{}

while(
  true // 5
  && true // 52
  ){}

while(true) {} // 6

while(true) /* 7 */ ++x;

while(1) // 8
  foo();

while (0) {// comment
}

while (0) {
  // comment
}

while (0) {/* comment */}

while ((0, 0/* comment */)) {}
