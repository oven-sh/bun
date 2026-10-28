function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

(function () {
    let onEffect = null;
    function hasEffect() { if (onEffect) onEffect(); }
    noInline(hasEffect);
    function Often(oftenFirst, oftenSecond, oftenThird) {
        this.oftenFirst = oftenFirst;
        this.oftenSecond = oftenSecond;
        this.oftenThird = oftenThird;
    }
    function makeSeldom(zzSeldomFirst, zzSeldomSecond, zzSeldomThird) { return { zzSeldomFirst, zzSeldomSecond, zzSeldomThird }; }
    noInline(makeSeldom);
    function readsOften(o) { let sum = o.oftenFirst; hasEffect(); sum += o.oftenSecond; hasEffect(); return sum + o.oftenThird; }
    function readsOftenAgain(o) { return o.oftenFirst + o.oftenSecond + o.oftenThird + o.oftenFirst + o.oftenSecond + o.oftenThird + o.oftenFirst + o.oftenSecond + o.oftenThird; }
    function readsSeldom(o) { let sum = o.zzSeldomFirst; hasEffect(); sum += o.zzSeldomSecond; hasEffect(); return sum + o.zzSeldomThird; }

    for (let i = 0; i < 300; ++i) {
        check(readsOften(new Often(i, 1, 2)), i + 3, "a family with a byte");
        check(readsOftenAgain(new Often(i, 1, 2)), 3 * i + 9, "a family with a byte, again");
        check(readsSeldom(makeSeldom(i, 1, 2)), i + 3, "a family without a byte");
    }
    for (let i = 0; i < 100; ++i) {
        let departs = makeSeldom(i, 1, 2);
        Object.defineProperty(departs, "zzSeldomSecond", { get() { return 10; }, configurable: true });
        check(readsSeldom(departs), i + 12, "a member that has left the family without a byte");
        check(readsSeldom(makeSeldom(i, 1, 2)), i + 3, "a member as born, after another has left");
        check(readsSeldom(new Proxy(makeSeldom(i, 1, 2), { })), i + 3, "a stranger");
    }
    for (const [reads, make, third] of [[readsSeldom, () => makeSeldom(1, 2, 3), "zzSeldomThird"], [readsOften, () => new Often(1, 2, 3), "oftenThird"]]) {
        let changing = make();
        onEffect = () => Object.defineProperty(changing, third, { get() { return 30; }, configurable: true });
        check(reads(changing), 33, "the receiver leaves its family between two guards of " + reads.name);
        onEffect = null;
        check(reads(make()), 6, "another member afterwards, in " + reads.name);
    }
})();
console.log("passed");
