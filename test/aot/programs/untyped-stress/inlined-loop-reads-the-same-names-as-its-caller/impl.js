function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
var firstGlobal = 3, secondGlobal = 50;
let firstLexical = 4, secondLexical = 60;

(function () {
    function countValue(o, n) {
        let s = 0;
        for (let i = 0; i < n; i++) {
            if (o.value === i)
                s++;
        }
        return s;
    }
    function countThirdAndValue(a, m) {
        let t = 0;
        for (let j = 0; j < m; j++) {
            if (a.third === j)
                t++;
        }
        return t * 10 + countValue(a, m);
    }
    for (let k = 0; k < 4; k++) {
        check(countThirdAndValue({ other: 1, third: 3, value: 50 }, 10), 10, "only the property of the caller matches");
        check(countThirdAndValue({ other: 1, third: 50, value: 3 }, 10), 1, "only the property of the inlined function matches");
        check(countThirdAndValue({ other: 1, third: 3, value: 4 }, 10), 11, "both properties match");
    }

    function countSecondGlobal(n) {
        let s = 0;
        for (let i = 0; i < n; i++) {
            if (secondGlobal === i)
                s++;
        }
        return s;
    }
    function countBothGlobals(m) {
        let t = 0;
        for (let j = 0; j < m; j++) {
            if (firstGlobal === j)
                t++;
        }
        return t * 10 + countSecondGlobal(m);
    }
    for (let k = 0; k < 4; k++)
        check(countBothGlobals(10), 10, "only the global variable of the caller matches");
    secondGlobal = 5;
    firstGlobal = 70;
    for (let k = 0; k < 4; k++)
        check(countBothGlobals(10), 1, "only the global variable of the inlined function matches");

    function countSecondLexical(n) {
        let s = 0;
        for (let i = 0; i < n; i++) {
            if (secondLexical === i)
                s++;
        }
        return s;
    }
    function countBothLexicals(m) {
        let t = 0;
        for (let j = 0; j < m; j++) {
            if (firstLexical === j)
                t++;
        }
        return t * 10 + countSecondLexical(m);
    }
    for (let k = 0; k < 4; k++)
        check(countBothLexicals(10), 10, "only the lexical variable of the caller matches");
    secondLexical = 6;
    firstLexical = 80;
    for (let k = 0; k < 4; k++)
        check(countBothLexicals(10), 1, "only the lexical variable of the inlined function matches");

    function countFourth(o, n) {
        let s = o.a + o.b + o.c;
        for (let i = 0; i < n; i++) {
            if (o.d === i)
                s++;
        }
        return s;
    }
    function hasFewerNames(list, o) {
        let t = 0;
        for (let j = 0; j < 4; j++) {
            if (list[j] === j)
                t++;
        }
        return t * 100 + countFourth(o, 10);
    }
    for (let k = 0; k < 4; k++)
        check(hasFewerNames([0, 1, 5, 5], { a: 1, b: 2, c: 3, d: 4 }), 207, "the inlined function has more names than its caller");

    function innermost(o, n) {
        let s = 0;
        for (let i = 0; i < n; i++) {
            if (o.z === i)
                s++;
        }
        return s;
    }
    function middle(o, n) {
        let s = 0;
        for (let i = 0; i < n; i++) {
            if (o.y === i)
                s++;
        }
        return s * 10 + innermost(o, n);
    }
    function outermost(o, n) {
        let s = 0;
        for (let i = 0; i < n; i++) {
            if (o.x === i)
                s++;
        }
        return s * 100 + middle(o, n);
    }
    for (let k = 0; k < 4; k++) {
        check(outermost({ x: 1, y: 20, z: 30 }, 10), 100, "three levels, the first matches");
        check(outermost({ x: 10, y: 2, z: 30 }, 10), 10, "three levels, the second matches");
        check(outermost({ x: 10, y: 20, z: 3 }, 10), 1, "three levels, the third matches");
    }
})();
console.log("passed");
