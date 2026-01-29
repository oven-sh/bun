// @bun
function foo(num) {
    num |= 0;
    let x1 = num % -2147483648;
    let x2 = x1 % 5;

    if (x2 > 5)
        throw "Error";
}

for (let i = 0; i < testLoopCount; i++)
    foo(i);
