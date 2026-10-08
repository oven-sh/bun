// https://github.com/prettier/prettier/issues/7126
for (;;) {
  if (condition) continue

  // breaking comment
  ;(possibleArray || []).sort()
}

lbl: for (;;) {
  if (condition) continue lbl

  // breaking comment
  ;(possibleArray || []).sort()
}

for (;;) {
  break // comment
  ;
  continue // comment
  ;
}

for (;;) {
  break
  // comment
  ;
  continue
  // comment
  ;
}

for (;;) {
  break /* comment */
  ;
  continue /* comment */
  ;
}

for (;;) {
  break
  /* comment */
  ;
  continue
  /* comment */
  ;
}
