if(
    true
    // 1
  ) {}

if(true)// 2
{}

if(true)
// 22
{}

if(true){}// 3

if(true)/*4*/{}

if(
  true // 5
  && true // 52
  ){}

if(true) {} // 6

if(true) /* 7 */ ++x;

if(1) // 8
  foo();

if (0) {// comment
}

if (0) {
  // comment
}

if (0) {/* comment */}

if ((0, 0/* comment */)) {}
