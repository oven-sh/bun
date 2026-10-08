a; /* a */ // b
; /* c */

foo; // first
;// second
;// third

function x() {
} // first
; // second

a = (
  b // 1
  + // 2
  c // 3
  + // 4
  d // 5
  + /* 6 */
  e // 7
);
