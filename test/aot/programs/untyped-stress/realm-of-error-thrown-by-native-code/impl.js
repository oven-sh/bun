function callIt(f) { return f(); }
function constructIt(f) { return new f(); }
function isArray(f) { return Array.isArray(f); }

for (let i = 0; i < 100; ++i) {
    for (const use of [callIt, constructIt, isArray]) {
        const { proxy, revoke } = Proxy.revocable(function () { }, {});
        revoke();
        let error;
        try {
            use(proxy);
        } catch (e) {
            error = e;
        }
        if (!(error instanceof TypeError))
            throw new Error(`${use.name}: expected a TypeError but got ${String(error)}`);
    }
}

function tooFewArguments(a, b, c, d, e, f, g, h) { return 1 + recurseThroughArityFixup(); }
function recurseThroughArityFixup() { return 1 + tooFewArguments(1); }
const withGetter = { get next() { return withGetter.next; } };
const converts = { toString() { return `${converts}`; } };
for (const overflow of [recurseThroughArityFixup, () => withGetter.next, () => `${converts}`]) {
    let error;
    try {
        overflow();
    } catch (e) {
        error = e;
    }
    if (!(error instanceof RangeError))
        throw new Error(`expected a RangeError but got ${String(error)}`);
}
console.log("passed");
