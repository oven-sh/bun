for(;;) {
    continue // comment
    ;
}

for (;;) {
    break // comment
    ;
}

for (const f of []) {
    continue // comment
    ;
}

for (const f of []) {
    break // comment
    ;
}

for (const f in {}) {
    continue // comment
    ;
}

for (const f in {}) {
    break // comment
    ;
}

while(true) {
    continue // comment
    ;
}

while (true) {
    break // comment
    ;
}

do {
    continue // comment
    ;
} while(true);


do {
    break // comment
    ;
} while(true);

label1: for (;;) {
    continue label1 // comment
    ;
}

label2: {
    break label2 // comment
    ;
};

for(;;) {
    continue /* comment */
    ;
}

for (;;) {
    break /* comment */
    ;
}

for (const f of []) {
    continue /* comment */
    ;
}

for (const f of []) {
    break /* comment */
    ;
}

for (const f in {}) {
    continue /* comment */
    ;
}

for (const f in {}) {
    break /* comment */
    ;
}

while(true) {
    continue /* comment */
    ;
}

while (true) {
    break /* comment */
    ;
}

do {
    continue /* comment */
    ;
} while(true);


do {
    break /* comment */
    ;
} while(true);

label1: for (;;) {
    continue label1 /* comment */
    ;
}

label2: {
    break label2 /* comment */
    ;
};
