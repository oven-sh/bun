function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

(function () {
    const classes = [];
    classes.push((function () { class Declares0 { first0; second0; third0; constructor(x) { this.first0 = x; this.second0 = x + 1; this.third0 = x + 2; } sum0() { return this.first0 + this.second0 + this.third0; } } return Declares0; })());
    classes.push((function () { class Declares1 { first1; second1; third1; constructor(x) { this.first1 = x; this.second1 = x + 1; this.third1 = x + 2; } sum1() { return this.first1 + this.second1 + this.third1; } } return Declares1; })());
    classes.push((function () { class Declares2 { first2; second2; third2; constructor(x) { this.first2 = x; this.second2 = x + 1; this.third2 = x + 2; } sum2() { return this.first2 + this.second2 + this.third2; } } return Declares2; })());
    classes.push((function () { class Declares3 { first3; second3; third3; constructor(x) { this.first3 = x; this.second3 = x + 1; this.third3 = x + 2; } sum3() { return this.first3 + this.second3 + this.third3; } } return Declares3; })());
    classes.push((function () { class Declares4 { first4; second4; third4; constructor(x) { this.first4 = x; this.second4 = x + 1; this.third4 = x + 2; } sum4() { return this.first4 + this.second4 + this.third4; } } return Declares4; })());
    classes.push((function () { class Declares5 { first5; second5; third5; constructor(x) { this.first5 = x; this.second5 = x + 1; this.third5 = x + 2; } sum5() { return this.first5 + this.second5 + this.third5; } } return Declares5; })());
    classes.push((function () { class Declares6 { first6; second6; third6; constructor(x) { this.first6 = x; this.second6 = x + 1; this.third6 = x + 2; } sum6() { return this.first6 + this.second6 + this.third6; } } return Declares6; })());
    classes.push((function () { class Declares7 { first7; second7; third7; constructor(x) { this.first7 = x; this.second7 = x + 1; this.third7 = x + 2; } sum7() { return this.first7 + this.second7 + this.third7; } } return Declares7; })());
    classes.push((function () { class Declares8 { first8; second8; third8; constructor(x) { this.first8 = x; this.second8 = x + 1; this.third8 = x + 2; } sum8() { return this.first8 + this.second8 + this.third8; } } return Declares8; })());
    classes.push((function () { class Declares9 { first9; second9; third9; constructor(x) { this.first9 = x; this.second9 = x + 1; this.third9 = x + 2; } sum9() { return this.first9 + this.second9 + this.third9; } } return Declares9; })());
    classes.push((function () { class Declares10 { first10; second10; third10; constructor(x) { this.first10 = x; this.second10 = x + 1; this.third10 = x + 2; } sum10() { return this.first10 + this.second10 + this.third10; } } return Declares10; })());
    classes.push((function () { class Declares11 { first11; second11; third11; constructor(x) { this.first11 = x; this.second11 = x + 1; this.third11 = x + 2; } sum11() { return this.first11 + this.second11 + this.third11; } } return Declares11; })());
    classes.push((function () { class Initializes { first = 1; second = 2; third = 3; constructor(x) { this.first = x; } sumOfInitialized() { return this.first + this.second + this.third; } } return Initializes; })());

    for (let round = 0; round < 200; ++round) {
        for (let i = 0; i < classes.length - 1; ++i)
            check(new classes[i](round)["sum" + i](), 3 * round + 3, "the sum of the fields of class " + i);
        check(new classes[classes.length - 1](round).sumOfInitialized(), round + 5, "the sum of fields with initializers");
    }
})();
console.log("passed");
