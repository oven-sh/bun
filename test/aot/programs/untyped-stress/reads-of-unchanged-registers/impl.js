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

    async function keptAcrossHandlers(n) {
        let log = 0;
        for (let outer = 0; outer < 1; outer++) {
            let kept = make(7);
            await one;
            for (let i = 0; i < n; i++) {
                try {
                    await one;
                    log += 1;
                } catch (error) {
                    log += kept.v;
                }
                await one;
            }
            log += kept.v;
        }
        return log;
    }
    check(resultOf(keptAcrossHandlers(3)), 10, "a variable that a handler reads and nothing changes");

    async function awaitsOnceInTry() {
        let x = make(5);
        try {
            return x.v + await one;
        } catch (error) {
            return x.v;
        }
    }
    check(resultOf(awaitsOnceInTry()), 6, "one suspension");

    async function usedAfterLoop(n) {
        let t = 0;
        for (let outer = 0; outer < 2; outer++) {
            let x = make(outer + 10);
            let y = outer * 2.5;
            let z = "z" + outer;
            t += await one;
            for (let i = 0; i < n; i++)
                t += await one;
            t += x.v + y + z.length;
        }
        return t;
    }
    check(resultOf(usedAfterLoop(3)), 35.5, "values that are only used behind a loop that awaits");
    check(resultOf(usedAfterLoop(0)), 29.5, "no iteration");

    async function passedAfterLoop(n) {
        let list = [];
        for (let outer = 0; outer < 1; outer++) {
            let x = make(3);
            let y = make(4);
            await one;
            for (let i = 0; i < n; i++)
                await one;
            list.push(x, y);
            list.push(make(x.v + y.v));
        }
        return list.map(item => item.v).join();
    }
    check(resultOf(passedAfterLoop(2)), "3,4,7", "values that are passed in calls behind the loop");

    async function changedOnOnePath(n, flag) {
        let log = "";
        for (let outer = 0; outer < 1; outer++) {
            let x = make("a");
            await one;
            for (let i = 0; i < n; i++)
                await one;
            if (flag)
                x = make("b");
            log += x.v;
            await one;
            log += x.v;
        }
        return log;
    }
    check(resultOf(changedOnOnePath(2, false)), "aa", "not changed behind the loop");
    check(resultOf(changedOnOnePath(2, true)), "bb", "changed behind the loop on one path");

    async function notInitializedBehindLoop(n) {
        let log = "";
        await one;
        for (let i = 0; i < n; i++)
            await one;
        try {
            log += later;
        } catch (error) {
            log += error.name;
        }
        let later = "set";
        await one;
        return log + later;
    }
    check(resultOf(notInitializedBehindLoop(2)), "ReferenceErrorset", "a variable that is not initialized is read behind the loop");

    async function hotLoopBetweenSuspensions(n) {
        let sum = 0;
        let step = make(2);
        await one;
        for (let outer = 0; outer < 2; outer++) {
            await one;
            for (let i = 0; i < n; i++)
                sum += step.v + i;
            await one;
        }
        return sum;
    }
    check(resultOf(hotLoopBetweenSuspensions(100)), 10300, "a loop without suspensions between two suspensions");

    async function changedBeforeThrow(n) {
        let log = "";
        for (let outer = 0; outer < 1; outer++) {
            let x = make(1);
            await one;
            for (let i = 0; i < n; i++) {
                try {
                    await one;
                    x = make(i + 10);
                    if (i & 1)
                        throw new Error("thrown");
                    await one;
                    log += "t" + x.v;
                } catch (error) {
                    await one;
                    log += "c" + x.v;
                }
                await one;
                log += "a" + x.v;
            }
        }
        return log;
    }
    check(resultOf(changedBeforeThrow(2)), "t10a10c11a11", "changed in front of a throw, read behind a suspension of the handler");

    async function changedInHandler(n) {
        let log = "";
        for (let outer = 0; outer < 1; outer++) {
            let x = make(1);
            await one;
            for (let i = 0; i < n; i++) {
                try {
                    await one;
                    if (i === 1)
                        throw new Error("thrown");
                } catch (error) {
                    x = make(2);
                } finally {
                    await one;
                    log += x.v;
                }
                await one;
                log += x.v;
            }
        }
        return log;
    }
    check(resultOf(changedInHandler(3)), "112222", "changed in a handler");

    async function swapsInTry(n) {
        let previous = 0;
        let current = 1;
        for (let i = 0; i < n; i++) {
            try {
                await one;
                let next = previous + current;
                previous = current;
                await one;
                current = next;
                await one;
            } catch (error) {
                return previous + current;
            }
        }
        return previous + " " + current;
    }
    check(resultOf(swapsInTry(10)), "55 89", "values that move from one variable to another, both read by a handler");

    async function rejectedInLoop(n) {
        let kept = make(4);
        let seen = 0;
        await one;
        for (let i = 0; i < n; i++) {
            try {
                await Promise.reject(i);
            } catch (error) {
                seen += error + kept.v;
                await one;
            }
        }
        return seen + kept.v;
    }
    check(resultOf(rejectedInLoop(3)), 19, "resumed by a rejection, and suspended in the handler");

    function* finishes(n) {
        let x = make(1);
        let y = make(2);
        try {
            for (let i = 0; i < n; i++)
                yield i;
            x = make(3);
            yield -1;
        } finally {
            yield x.v * 10 + y.v;
            yield x.v * 100 + y.v;
        }
    }
    check([...finishes(2)].join(), "0,1,-1,32,302", "a generator that runs to its end");
    let returned = finishes(3);
    check(returned.next().value, 0, "started");
    check(returned.next().value, 1, "resumed");
    check(returned.return(9).value, 12, "made to return");
    check(returned.next().value, 102, "goes on in the finally block");
    check(returned.next().value, 9, "the value it was made to return");
    let thrown = finishes(0);
    check(thrown.next().value, -1, "no iteration");
    check(thrown.throw(new Error("thrown")).value, 32, "made to throw");
    check(thrown.next().value, 302, "goes on in the finally block");

    async function* producesInTry(n) {
        let base = make(100);
        let last = make(0);
        try {
            yield base.v;
            for (let i = 0; i < n; i++) {
                await one;
                if (i === 2)
                    last = make(i);
                yield base.v + last.v + i;
            }
        } finally {
            await one;
            yield base.v + last.v;
        }
    }
    async function consumesInTry(n) {
        let log = [];
        let prefix = make("p");
        try {
            await one;
            for await (let item of producesInTry(n))
                log.push(prefix.v + item);
        } catch (error) {
            log.push(prefix.v + error);
        }
        return log.join();
    }
    check(resultOf(consumesInTry(4)), "p100,p100,p101,p104,p105,p102", "an async generator and its consumer, both with handlers");

    async function nestedHandlers(n) {
        let outerKept = make("o");
        let innerKept = make("i");
        let log = "";
        await one;
        for (let i = 0; i < n; i++) {
            try {
                await one;
                try {
                    await one;
                    if (i === 1)
                        throw "x";
                    innerKept = make("j" + i);
                    if (i === 2)
                        throw "y";
                } catch (error) {
                    await one;
                    log += error + innerKept.v;
                    if (error === "y")
                        throw "z";
                }
                await one;
            } catch (error) {
                await one;
                log += error + outerKept.v + innerKept.v;
            }
        }
        return log;
    }
    check(resultOf(nestedHandlers(3)), "xj0yj2zoj2", "handlers in handlers");

    async function takeTurns(id, n) {
        let t = 0;
        let mine = make(id);
        try {
            await one;
            for (let i = 0; i < n; i++) {
                await one;
                t += mine.v;
            }
        } catch (error) {
            t = mine.v;
        }
        return t;
    }
    check(resultOf(Promise.all([takeTurns(1, 3), takeTurns(10, 2), takeTurns(100, 4)])).join(), "3,20,400", "activations that take turns");
})();
console.log("passed");
