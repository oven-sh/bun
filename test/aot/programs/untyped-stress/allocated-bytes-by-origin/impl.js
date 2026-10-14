const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTOperationCounters=1", "--useMiniVMModeWithoutJIT=0")

function shouldBe(actual, expected, what)
{
    if (actual !== expected)
        throw new Error(what + ": " + actual + " instead of " + expected);
}

(function () {
    function probe() { return 1; }
    const counts = typeof aotOperationCount === "function" && isAOTCompiled(probe) && aotOperationCount("Heap::didAllocate") !== null;
    function bytes(detail) { return counts ? aotOperationCount("Heap::didAllocate" + detail) : 0; }
    function atLeast(actual, limit, what)
    {
        if (counts && actual < limit)
            throw new Error(what + ": " + actual + " bytes, at least " + limit + " expected");
    }
    function atMost(actual, limit, what)
    {
        if (counts && actual > limit)
            throw new Error(what + ": " + actual + " bytes, at most " + limit + " expected");
    }

    const holder = [null];
    const MB = 1024 * 1024;

    let total = bytes("");
    let inBlocks = bytes(":block:JSCell:48");
    let precise = bytes(":precise:Auxiliary");
    let extra = bytes(":extra:string");
    for (let i = 0; i < 400000; ++i)
        holder[0] = { first: i, second: i, third: i, fourth: i };
    shouldBe(holder[0].fourth, 399999, "the last object");
    atLeast(bytes(":block:JSCell:48") - inBlocks, 12 * MB, "objects of 48 bytes are charged to the blocks they come from");
    atMost(bytes(":block:JSCell:48") - inBlocks, 24 * MB, "objects of 48 bytes are charged once");
    atLeast(bytes("") - total, bytes(":block:JSCell:48") - inBlocks, "the total contains the part");
    atMost(bytes(":precise:Auxiliary") - precise, MB, "small objects are not large allocations");
    atMost(bytes(":extra:string") - extra, MB, "small objects report no memory of strings");

    total = bytes("");
    inBlocks = bytes(":block:JSCell:48");
    precise = bytes(":precise:Auxiliary");
    for (let i = 0; i < 40; ++i) {
        const array = new Array(90000);
        array.fill(i);
        holder[0] = array;
    }
    shouldBe(holder[0][89999], 39, "the last array");
    atLeast(bytes(":precise:Auxiliary") - precise, 24 * MB, "the storage of large arrays is charged as large allocations");
    atLeast(bytes("") - total, bytes(":precise:Auxiliary") - precise, "the total contains the large allocations");
    atMost(bytes(":block:JSCell:48") - inBlocks, MB, "large arrays are not objects of 48 bytes");

    total = bytes("");
    extra = bytes(":extra:string");
    precise = bytes(":precise:Auxiliary");
    let characters = 0;
    for (let i = 0; i < 40; ++i) {
        holder[0] = ("x" + i).repeat(200000);
        characters += holder[0].charCodeAt(0);
    }
    shouldBe(characters, 40 * 120, "the strings");
    atLeast(bytes(":extra:string") - extra, 6 * MB, "the characters of long strings are charged to strings");
    atLeast(bytes("") - total, bytes(":extra:string") - extra, "the total contains the memory of strings");
    atMost(bytes(":precise:Auxiliary") - precise, MB, "strings are not large allocations");

    total = bytes("");
    extra = bytes(":extra:string");
    let buffers = bytes(":buffer:ArrayBuffer");
    let other = bytes(":other");
    let byteLength = 0;
    for (let i = 0; i < 40; ++i) {
        holder[0] = new ArrayBuffer(500000);
        byteLength += holder[0].byteLength;
    }
    shouldBe(byteLength, 20000000, "the buffers");
    atLeast(bytes(":buffer:ArrayBuffer") - buffers, 16 * MB, "the contents of buffers are charged to buffers");
    atLeast(bytes("") - total, bytes(":buffer:ArrayBuffer") - buffers, "the total contains the contents of buffers");
    atMost(bytes(":other") - other, MB, "the contents of buffers have a name");
    atMost(bytes(":extra:string") - extra, MB, "buffers are not strings");

    function collections(scope) { return counts ? aotOperationCount("Heap::collection:" + scope) : 0; }
    const full = collections("full");
    const eden = collections("eden");
    fullGC();
    edenGC();
    shouldBe(collections("full") > full, counts, "a full collection is counted");
    shouldBe(collections("eden") > eden, counts, "an eden collection is counted");

    function live(detail) { return counts ? aotOperationCount("Heap::live:" + detail) : 0; }
    holder[0] = null;
    fullGC();
    const liveBefore = live("block:JSCell:48");
    const kept = [];
    for (let i = 0; i < 200000; ++i)
        kept.push({ first: i, second: i, third: i, fourth: i });
    fullGC();
    atLeast(live("block:JSCell:48") - liveBefore, 8 * MB, "objects that are kept are live at a full collection");
    shouldBe(kept[199999].fourth, 199999, "the last object that is kept");
    kept.length = 0;
    fullGC();
    atMost(live("block:JSCell:48") - liveBefore, MB, "objects that are dropped are not");
})();
console.log("passed");
