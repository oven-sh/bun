
class Foo {
  a(lol /*string*/) {}

  b(lol /*string*/
  ) {}

  d(
    lol /*string*/,
    lol2 /*string*/,
    lol3 /*string*/,
    lol4 /*string*/
  ) {}

  d(
    lol /*string*/,
    lol2 /*string*/,
    lol3 /*string*/,
    lol4 /*string*/
  ) /*string*/ {}

  // prettier-ignore
  c(lol /*string*/
  ) {}

  // prettier-ignore
  d(
    lol /*string*/,
    lol2 /*string*/,
    lol3 /*string*/,
    lol4 /*string*/
  ) {}

  // prettier-ignore
  e(
    lol /*string*/,
    lol2 /*string*/,
    lol3 /*string*/,
    lol4 /*string*/
  ) {} /* string*/
}
