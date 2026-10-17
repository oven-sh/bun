function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function resultOf(promise) {
    let result;
    let failed = false;
    promise.then(value => { result = value; }, error => { failed = true; result = error; });
    drainMicrotasks();
    if (failed)
        throw result;
    return result;
}

(function () {
    const one = Promise.resolve(1);
    const make = v => ({ v });

    async function unchangedInLoop(n) {
        let t = 0;
        for (let outer = 0; outer < 2; outer++) {
            let x = make(outer + 10);
            let y = outer * 2.5;
            t += await one;
            for (let i = 0; i < n; i++)
                t += await one;
            t += x.v + y;
        }
        return t;
    }
    check(resultOf(unchangedInLoop(3)), 31.5, "values that stay the same in a loop that awaits");

    async function awaitsOnce() {
        let x = make(5);
        let v = await one;
        return x.v + v;
    }
    check(resultOf(awaitsOnce()), 6, "one suspension");

    async function changesSometimes(n) {
        let log = "";
        for (let outer = 0; outer < 1; outer++) {
            let x = make(0);
            await one;
            for (let i = 0; i < n; i++) {
                if (i & 1)
                    x = make(i);
                await one;
                log += x.v;
            }
        }
        return log;
    }
    check(resultOf(changesSometimes(6)), "011335", "a value that changes on one path");

    async function swaps(n) {
        let previous = 0;
        let current = 1;
        for (let i = 0; i < n; i++) {
            await one;
            let next = previous + current;
            previous = current;
            await one;
            current = next;
            await one;
        }
        return previous + " " + current;
    }
    check(resultOf(swaps(10)), "55 89", "values that move from one variable to another");

    async function rotates(n) {
        let a = make(1);
        let b = make(2);
        let c = make(3);
        await one;
        for (let i = 0; i < n; i++) {
            let kept = a;
            a = b;
            await one;
            b = c;
            await one;
            c = kept;
        }
        return "" + a.v + b.v + c.v;
    }
    check(resultOf(rotates(4)), "231", "objects that rotate through three variables");
    check(resultOf(rotates(3)), "123", "and come back");

    async function catches(n) {
        let log = "";
        for (let outer = 0; outer < 1; outer++) {
            let x = make(1);
            let kept = make(7);
            await one;
            for (let i = 0; i < n; i++) {
                try {
                    await one;
                    if (i === 1) {
                        x = make(2);
                        throw new Error("thrown");
                    }
                    await one;
                } catch (error) {
                    await one;
                    log += "c" + x.v;
                    x = make(3);
                } finally {
                    await one;
                    log += "f" + x.v + kept.v;
                }
            }
        }
        return log;
    }
    check(resultOf(catches(3)), "f17c2f37f37", "values changed in front of a throw and in a handler");

    async function rejected(n) {
        let x = make(4);
        let seen = 0;
        await one;
        for (let i = 0; i < n; i++) {
            try {
                await Promise.reject(i);
            } catch (error) {
                seen += error + x.v;
            }
        }
        return seen;
    }
    check(resultOf(rejected(3)), 15, "resumed by a rejection");

    function* yields(n) {
        for (let outer = 0; outer < 2; outer++) {
            let x = make(outer);
            let step = outer + 1;
            yield -1;
            for (let i = 0; i < n; i++)
                yield x.v * 10 + i * step;
            x = make(x.v + 5);
            yield x.v;
        }
    }
    check([...yields(2)].join(), "-1,0,1,5,-1,10,12,6", "a generator");

    function* finishes() {
        let x = make(1);
        let y = make(2);
        try {
            yield 1;
            yield 2;
            x = make(3);
            yield 3;
        } finally {
            yield x.v * 10 + y.v;
        }
    }
    let returned = finishes();
    check(returned.next().value, 1, "started");
    check(returned.next().value, 2, "resumed");
    check(returned.return(9).value, 12, "made to return");
    check(returned.next().value, 9, "the value it was made to return");
    let thrown = finishes();
    thrown.next();
    thrown.next();
    thrown.next();
    check(thrown.throw(new Error("thrown")).value, 32, "made to throw");

    async function* produces(n) {
        for (let outer = 0; outer < 1; outer++) {
            let base = make(100);
            let last = make(0);
            yield base.v;
            for (let i = 0; i < n; i++) {
                await one;
                if (i === 2)
                    last = make(i);
                yield base.v + last.v + i;
            }
        }
    }
    async function consumes(n) {
        let log = [];
        for (let outer = 0; outer < 1; outer++) {
            let prefix = make("p");
            await one;
            for await (let item of produces(n))
                log.push(prefix.v + item);
        }
        return log.join();
    }
    check(resultOf(consumes(4)), "p100,p100,p101,p104,p105", "an async generator and its consumer");

    async function uninitialized(n) {
        let log = "";
        await one;
        for (let i = 0; i < n; i++) {
            await one;
            try {
                log += later;
            } catch (error) {
                log += error.name;
            }
        }
        let later = "set";
        await one;
        return log + later;
    }
    check(resultOf(uninitialized(2)), "ReferenceErrorReferenceErrorset", "a variable that is not initialized across suspensions");

    async function manyActivations(id, n) {
        let t = 0;
        for (let outer = 0; outer < 1; outer++) {
            let mine = make(id);
            await one;
            for (let i = 0; i < n; i++) {
                await one;
                t += mine.v;
            }
        }
        return t;
    }
    check(resultOf(Promise.all([manyActivations(1, 3), manyActivations(10, 2), manyActivations(100, 4)])).join(), "3,20,400", "activations that take turns");
})();
console.log("passed");
