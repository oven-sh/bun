switch(
    true
    // 1
  ) {}

switch(true)// 2
{}

switch(true)
// 22
{}

switch(true){}// 3

switch(true)/*4*/{}

switch(
  true // 5
  && true // 52
  ){}

switch(true) {} // 6

switch (0) {// comment
}

switch (0) {
  // comment
}

switch (0) {/* comment */}

switch ((0, 0/* comment */)) {}
