function shouldBe(actual, expected, what)
{
    if (actual !== expected)
        throw new Error(what + ": " + actual + " instead of " + expected);
}

(function () {
    const numberOfShapes = 40;
    const objects = [];
    for (let i = 0; i < numberOfShapes; ++i) {
        const object = { };
        object["unique" + i] = i;
        object.shared = i;
        objects.push(object);
    }

    function reads(o) { return o.shared; }
    function writes(o, v) { o.shared = v; }
    function has(o) { return "shared" in o; }
    function useAll(rounds)
    {
        for (let round = 0; round < rounds; ++round) {
            for (let i = 0; i < numberOfShapes; ++i) {
                const object = objects[i];
                writes(object, i + round);
                shouldBe(reads(object), i + round, "a property of one of many shapes");
                shouldBe(has(object), true, "the presence of a property in one of many shapes");
            }
        }
    }

    useAll(300);

    useAll(100);

    for (let collection = 0; collection < 3; ++collection) {
        edenGC();
        useAll(100);

        fullGC();
        useAll(100);
    }

    objects.length = numberOfShapes / 2;
    fullGC();
    for (let i = 0; i < 2000; ++i) {
        const object = { };
        object["later" + i] = i;
        object.other = 0;
        object.shared = -i;
        shouldBe(reads(object), -i, "a property of a shape made after others died");
        writes(object, i);
        shouldBe(object.shared, i, "a property written in a shape made after others died");
        shouldBe(has(object), true, "the presence of a property in a shape made after others died");
    }
})();
console.log("passed");
