type A = B extends T
  ? // comment
    foo
  : bar;

type A = B extends test /* comment
  comment
      comment
*/
  ? foo
  : bar;

type T = test extends B
  ? /* comment
          comment
    comment
          comment
  */
    foo
  : bar;

type T = test extends B
  ? /* comment
       comment
       comment
       comment
    */
    foo
  : test extends B
  ? /* comment
  comment
    comment */
    foo
  : bar;

type T = test extends B
  ? /* comment */
    foo
  : bar;

type T = test extends B
  ? foo
  : /* comment
         comment
     comment
           comment
    */
  bar;

type T = test extends B
  ? foo
  : /* comment
         comment
     comment
           comment
    */
  test extends B
  ? foo
  : /* comment
  comment
    comment
   */
    bar;

type T = test extends B
  ? foo
  : /* comment */
  bar;

type T = test extends B ? test extends B /* c
c */? foo : bar : bar;

type T = any extends B
    // Comment
    // Multiline comment
    ? B | C
    : D;
T = any instanceof B
    // Comment
    // Multiline comment
    ? B | C
    : D;
T = any instanceof B
    ? D
    // Comment
    // Multiline comment
    : B | C;

type T = any extends B
    // Comment
    ? B | C
    : D;
T = any instanceof B
    // Comment
    ? B | C
    : D;

type T = any extends B
  /**
  * Comment
  */
    ? B | C
    : D;
T = any instanceof B
  /**
  * Comment
  */
    ? B | C
    : D;
type T = any extends B
  ?/* Comment */
     B | C
    : D;
T = any instanceof B
  ?/* Comment */
     B | C
    : D;
