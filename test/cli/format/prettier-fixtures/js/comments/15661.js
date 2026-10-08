!(
    x || // foo
    y || // bar
    z /*
    * comment
    */
)

!(
    cond1 || // foo
    cond2 || // bar
    cond3 // baz
);

!(
    a && // alpha
    b || // bravo
    c // charlie
);

!(
    x || // foo
    (y && z) // bar
);

!(
    a || // first condition
    (b || c) // second condition
    || d // third condition
);

void(
    p && // first
    q || // second
    r && // third
    s // fourth
);

void(
    cond1 || // foo
    cond2 && // bar
    cond3 || // baz
    cond4 // qux
);

!(
    (cond1 && cond2) || // multi-cond1
    (cond3 || cond4) // multi-cond2
);

!(
    (cond1 || cond2) && // complex-cond1
    (cond3 || cond4) || // complex-cond2
    cond5 // complex-cond3
);

void(
    (condA || condB) && // test A
    (condC || condD) || // test B
    condE // test C
);

void(
    (x || y) && ( // nested
    z || w) // comment for w
);

!(
    a && ( // begin nested
    b || c) // end nested
);
