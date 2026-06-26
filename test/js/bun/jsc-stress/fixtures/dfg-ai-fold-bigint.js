// @bun
function shouldBe(actual, expected) {
    if (actual !== expected)
        throw new Error('bad value: ' + actual);
}

function allAreTrue(list)
{
    for (let item of list)
        shouldBe(item, true);
}

function allAreFalse(list)
{
    for (let item of list)
        shouldBe(item, false);
}

function lessThan()
{
    return [0n < 2n, -10n < 20n, -10n < -2n, -100000000000000n < 0n, -100000000000000n < 10000n, -100000000000000n < -10000n, -1000000000000000000000n < -100000000000n, 1000000000000000000000n < 1000000000000000000000000n];
}
noInline(lessThan);

function lessThanFalse()
{
    return [100000000000000000000n < 100000000000000000000n, 0n < 0n, 2n < 0n, 2n < 2n, -10n < -10n, 20n < -20n, -2n < -10n, 0n < -100000000000000n, -10000n < -100000000000000n, -100000000000n < -1000000000000000000000n, 1000000000000000000000000n < 1000000000000000000000n ];
}
noInline(lessThanFalse);

function lessThanEqual()
{
    return [100000000000000000000n <= 100000000000000000000n, 0n <= 0n, 0n <= 2n, 2n <= 2n, -10n <= -10n, -20n <= 20n, -10n <= -2n, -100000000000000n <= 0n, -100000000000000n <= -10000n, -1000000000000000000000n <= -100000000000n, 1000000000000000000000n <= 1000000000000000000000000n ];
}
noInline(lessThanEqual);

function lessThanEqualFalse()
{
    return [100000000000000000001n <= 100000000000000000000n, 1n <= 0n, 2n <= 0n, 3n <= 2n, -10n <= -11n, 20n <= -20n, -2n <= -10n, 0n <= -100000000000000n, -10000n <= -100000000000000n, -100000000000n <= -1000000000000000000000n, 1000000000000000000000000n <= 1000000000000000000000n ];
}
noInline(lessThanEqualFalse);

function greaterThan()
{
    return [2n > 0n, 20n > -10n, -2n > -10n, 0n > -100000000000000n, 10000n > -100000000000000n, -10000n > -100000000000000n, -100000000000n > -1000000000000000000000n, 1000000000000000000000000n > 1000000000000000000000n ];
}
noInline(greaterThan);

function greaterThanFalse()
{
    return [100000000000000000000n > 100000000000000000000n, 0n > 0n, 0n > 2n, 2n > 2n, -10n > -10n, -20n > 20n, -10n > -2n, -100000000000000n > 0n, -100000000000000n > -10000n, -1000000000000000000000n > -100000000000n, 1000000000000000000000n > 1000000000000000000000000n ];
}
noInline(greaterThanFalse);

function greaterThanEqual()
{
    return [100000000000000000000n >= 100000000000000000000n, 0n >= 0n, 2n >= 0n, 2n >= 2n, -10n >= -10n, 20n >= -20n, -2n >= -10n, 0n >= -100000000000000n, -10000n >= -100000000000000n, -100000000000n >= -1000000000000000000000n, 1000000000000000000000000n >= 1000000000000000000000n ];
}
noInline(greaterThanEqual);

function greaterThanEqualFalse()
{
    return [100000000000000000000n >= 100000000000000000001n, 0n >= 1n, 0n >= 2n, 2n >= 3n, -11n >= -10n, -20n >= 20n, -10n >= -2n, -100000000000000n >= 0n, -100000000000000n >= -10000n, -1000000000000000000000n >= -100000000000n, 1000000000000000000000n >= 1000000000000000000000000n ];
}
noInline(greaterThanEqualFalse);

function equal()
{
    return [100000000000000000000n == 100000000000000000000n, 0n == 0n, 2n == 2n, -2n == -2n, -20n == -20n, -100000000000000n == -100000000000000n];
}
noInline(equal);

function equalFalse()
{
    return [100000000000000000001n == 100000000000000000000n, 1n == 0n, -2n == 2n, 2n == -2n, -20n == 20n, -100000000000000n == 100000000000000n, 100000000000000n == -100000000000000n, -100000000000001n == -100000000000000n, 100000000000001n == 100000000000000n, -100000000000000n == 1n, 100000000000000n == 1n, -1n == 100000000000000n, 1n == -100000000000000n, -1n == -100000000000000n];
}
noInline(equalFalse);

for (var i = 0; i < 1e4; ++i) {
    allAreTrue(lessThan());
    allAreTrue(lessThanEqual());
    allAreTrue(greaterThan());
    allAreTrue(greaterThanEqual());
    allAreTrue(equal());

    allAreFalse(lessThanFalse());
    allAreFalse(lessThanEqualFalse());
    allAreFalse(greaterThanFalse());
    allAreFalse(greaterThanEqualFalse());
    allAreFalse(equalFalse());
}
