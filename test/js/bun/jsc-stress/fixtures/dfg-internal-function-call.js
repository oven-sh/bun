// @bun
function shouldBe(actual, expected) {
    if (actual !== expected)
        throw new Error('bad value: ' + actual);
}
noInline(shouldBe);

function target(func)
{
    return func();
}
noInline(target);

for (var i = 0; i < 1e4; ++i)
    shouldBe(target(Array).length, 0);
