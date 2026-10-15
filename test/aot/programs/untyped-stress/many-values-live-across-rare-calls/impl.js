function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

(function () {
    function countHoles(a) {
        let v0 = 0, v1 = 0, v2 = 0, v3 = 0, v4 = 0, v5 = 0, v6 = 0, v7 = 0, v8 = 0, v9 = 0, v10 = 0,
            v11 = 0, v12 = 0, v13 = 0, v14 = 0, v15 = 0, v16 = 0, v17 = 0, v18 = 0, v19 = 0, v20 = 0, v21 = 0;
        for (let i = 0; i < a.length; ++i) {
            if (a[i] === undefined) {
                v0 = (v0 + 1) | 0; v1 = (v1 + 2) | 0; v2 = (v2 + 3) | 0; v3 = (v3 + 4) | 0; v4 = (v4 + 5) | 0; v5 = (v5 + 6) | 0;
                v6 = (v6 + 7) | 0; v7 = (v7 + 8) | 0; v8 = (v8 + 9) | 0; v9 = (v9 + 10) | 0; v10 = (v10 + 11) | 0; v11 = (v11 + 12) | 0;
                v12 = (v12 + 13) | 0; v13 = (v13 + 14) | 0; v14 = (v14 + 15) | 0; v15 = (v15 + 16) | 0; v16 = (v16 + 17) | 0;
                v17 = (v17 + 18) | 0; v18 = (v18 + 19) | 0; v19 = (v19 + 20) | 0; v20 = (v20 + 21) | 0; v21 = (v21 + 22) | 0;
            }
        }
        return [v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15, v16, v17, v18, v19, v20, v21].join();
    }

    function sumOfSeveralArrays(a, b, c, d, e, f, g, h) {
        let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, s5 = 0, s6 = 0, s7 = 0;
        for (let i = 0; i < a.length; ++i) {
            if (a[i] === undefined) s0 = (s0 + 1) | 0;
            if (b[i] === undefined) s1 = (s1 + 2) | 0;
            if (c[i] === undefined) s2 = (s2 + 3) | 0;
            if (d[i] === undefined) s3 = (s3 + 4) | 0;
            if (e[i] === undefined) s4 = (s4 + 5) | 0;
            if (f[i] === undefined) s5 = (s5 + 6) | 0;
            if (g[i] === undefined) s6 = (s6 + 7) | 0;
            if (h[i] === undefined) s7 = (s7 + 8) | 0;
        }
        return [s0, s1, s2, s3, s4, s5, s6, s7].join();
    }

    function holes(length) {
        const result = [];
        result.length = length;
        return result;
    }

    let expected = [];
    for (let i = 1; i <= 22; ++i)
        expected.push(i * 1000);
    check(countHoles(holes(1000)), expected.join(), "22 variables around a loop whose element reads all take the slow path");

    check(sumOfSeveralArrays(holes(100), holes(100), holes(100), holes(100), holes(100), holes(100), holes(100), holes(100)),
        "100,200,300,400,500,600,700,800", "eight arrays and eight sums around a loop whose element reads all take the slow path");
})();
console.log("passed");
