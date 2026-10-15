function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

let afterCall = () => { };
function calls() { afterCall(); }

function outermost(a) {
    let shared = a;
    function middle(b) {
        let own = b;
        function innermost(c, takesFirst) {
            let result = [shared, own];
            calls();
            if (takesFirst) {
                result.push(shared, own);
                shared += c;
                calls();
                result.push(shared, own);
            } else {
                result.push(own, shared);
                own += c;
                calls();
                result.push(own, shared);
            }
            calls();
            result.push(shared, own);
            for (let i = 0; i < 2; i++) {
                calls();
                result.push(shared + own);
            }
            return result.join();
        }
        return { innermost, setsOwn(v) { own = v; }, getsOwn() { return own; } };
    }
    return { middle, setsShared(v) { shared = v; }, getsShared() { return shared; } };
}

let first = outermost(1), second = outermost(100);
let firstMiddle = first.middle(10), otherMiddle = first.middle(20), secondMiddle = second.middle(1000);

check(firstMiddle.innermost(1, true), "1,10,1,10,2,10,2,10,12,12", "nothing changes during the calls, first path");
check(firstMiddle.innermost(1, false), "2,10,10,2,11,2,2,11,13,13", "nothing changes during the calls, second path");
check(otherMiddle.innermost(5, false), "2,20,20,2,25,2,2,25,27,27", "another environment with the same parent");
check(secondMiddle.innermost(7, true), "100,1000,100,1000,107,1000,107,1000,1107,1107", "another chain");

let count = 0;
afterCall = () => {
    count++;
    first.setsShared(first.getsShared() + 1000);
    firstMiddle.setsOwn(firstMiddle.getsOwn() + 100000);
};
check(firstMiddle.innermost(1, true), "2,11,1002,100011,2003,200011,3003,300011,404014,505014", "both variables change during every call, first path");
check(count, 5, "the number of calls");
check(firstMiddle.innermost(1, false), "5003,500011,600011,6003,700012,7003,8003,800012,909015,1010015", "both variables change during every call, second path");
check(otherMiddle.innermost(0, true), "10003,25,11003,25,12003,25,13003,25,14028,15028", "only the parent's variable changes for the other environment");
check(secondMiddle.innermost(0, false), "107,1000,1000,107,1000,107,107,1000,1107,1107", "nothing changes for the other chain");
afterCall = () => { };

function deep(a) {
    return function (b) {
        return function (c) {
            return function (d) {
                return function (choose) {
                    let sum = a + b + c + d;
                    calls();
                    if (choose)
                        sum += a + c;
                    else
                        sum += b + d;
                    calls();
                    a++, b++, c++, d++;
                    return sum + a + b + c + d;
                };
            };
        };
    };
}
let deepest = deep(1)(10)(100)(1000);
check(deepest(true), 1111 + 101 + 1115, "four levels, first path");
check(deepest(false), 1115 + 1012 + 1119, "four levels, second path");
let sibling = deep(2)(20)(200)(2000);
check(sibling(true), 2222 + 202 + 2226, "another chain of four levels");
check(deepest(true), 1119 + 105 + 1123, "the first chain again");
console.log("passed");
