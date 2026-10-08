// https://github.com/prettier/prettier/issues/7126
for (;;) {
  if (condition){ continue

  // breaking comment
  ;(possibleArray || []).sort()
  }
}

lbl: for (;;) {
  if (condition){ continue lbl

  // breaking comment
  ;(possibleArray || []).sort()
  }
}

lbl: for (;;) {
  if (condition){
    // prettier-ignore
    continue                   lbl

    // breaking comment
    ;(possibleArray || []).sort()
  }
  if (condition){
    // prettier-ignore
    break                   lbl;

    // breaking comment
    ;(possibleArray || []).sort()
  }
}
