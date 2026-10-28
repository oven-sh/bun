function shouldBe(actual, expected, what)
{
    if (actual !== expected)
        throw new Error(what + ": " + actual + " instead of " + expected);
}

(function () {
    const kept = [null, null, null, null];

    class Point {
        constructor(x, y)
        {
            this.x = x;
            this.y = y;
        }
    }

    function makesEmptyArrays(count)
    {
        for (let i = 0; i < count; ++i)
            kept[i & 3] = [];
        return kept[0].length;
    }

    function makesArrays(count)
    {
        for (let i = 0; i < count; ++i)
            kept[i & 3] = [i, kept];
        return kept[0].length;
    }

    function makesLongerArrays(count)
    {
        for (let i = 0; i < count; ++i)
            kept[i & 3] = [i, kept, i, kept, i, kept, i];
        return kept[0].length;
    }

    function makesObjects(count)
    {
        for (let i = 0; i < count; ++i)
            kept[i & 3] = { first: 2, second: kept };
        return kept[0].first;
    }

    function makesEmptyObjects(count)
    {
        for (let i = 0; i < count; ++i)
            kept[i & 3] = {};
        return Object.keys(kept[0]).length;
    }

    function makesClosures(count)
    {
        for (let i = 0; i < count; ++i)
            kept[i & 3] = () => i - i + 3;
        return kept[0]();
    }

    function makesInstances(count)
    {
        for (let i = 0; i < count; ++i)
            kept[i & 3] = new Point(4, kept);
        return kept[0].x;
    }

    const cases = [
        [makesEmptyArrays, 0],
        [makesArrays, 2],
        [makesLongerArrays, 7],
        [makesObjects, 2],
        [makesEmptyObjects, 0],
        [makesClosures, 3],
        [makesInstances, 4],
    ];

    for (const [make, expected] of cases) {
        for (let i = 0; i < 200; ++i)
            shouldBe(make(10), expected, make.name);
        for (let collection = 0; collection < 3; ++collection) {
            if (collection)
                gc();
            for (let i = 0; i < 100; ++i)
                shouldBe(make(100), expected, make.name);
        }
    }
})();
console.log("passed");
