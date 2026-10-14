const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function countersOf(name, opcode) {
    let operations = aotTypeCoverage(name).map(line => line.split(" ")).filter(fields => fields[1] === opcode);
    return {
        timesRun: Math.max(...operations.map(fields => Number(fields[3]))),
        stubCalls: Math.max(...operations.map(fields => Number(fields[4]))),
    };
}

function fromZero(objects) {
    let sum = 0;
    for (let i = 0; i < objects.length; i++)
        sum += objects[i].value;
    return sum;
}
function fromOne(objects) {
    let sum = 0;
    for (let i = 1; i < objects.length; i++)
        sum += objects[i].value;
    return sum;
}
function downFromConstant(objects) {
    let sum = 0;
    for (let i = 99; i >= 0; i--)
        sum += objects[i].value;
    return sum;
}
function whileLoop(objects) {
    let sum = 0, i = 0;
    while (i < objects.length) {
        sum += objects[i].value;
        i++;
    }
    return sum;
}
function doWhileLoop(objects) {
    let sum = 0, i = 0;
    do {
        sum += objects[i].value;
        i++;
    } while (i < objects.length);
    return sum;
}
function twoCounters(objects) {
    let sum = 0, seen = 0;
    for (let i = 0; i < objects.length; i++) {
        sum += objects[i].value;
        seen++;
    }
    return sum + seen;
}
function nested(rows) {
    let sum = 0;
    for (let i = 0; i < rows.length; i++) {
        let row = rows[i];
        for (let j = 0; j < row.length; j++)
            sum += row[j].value;
    }
    return sum;
}
function overHole(numbers) {
    let sum = 0;
    for (let i = 0; i < numbers.length; i++) {
        let number = numbers[i];
        if (number !== undefined)
            sum += number;
    }
    return sum;
}
function fromAnywhere(objects, start) {
    let sum = 0;
    for (let i = start | 0; i < objects.length; i++)
        sum += objects[i].value;
    return sum;
}
function byTwo(objects) {
    let sum = 0;
    for (let i = 0; i < objects.length; i += 2)
        sum += objects[i].value;
    return sum;
}
function fromFraction(objects, start) {
    let sum = 0;
    for (let i = start; i < 99; i++)
        sum += objects[i + 0.5].value;
    return sum;
}

let objects = [];
for (let i = 0; i < 100; i++)
    objects.push({ value: i });
let numbers = [];
for (let i = 0; i < 100; i++)
    numbers.push(i);
delete numbers[50];
let rows = [];
for (let i = 0; i < 10; i++) {
    rows.push([]);
    for (let j = 0; j < 10; j++)
        rows[i].push({ value: j });
}

check(fromZero(objects), 4950, "a counter from zero");
check(fromOne(objects), 4950, "a counter from one");
check(downFromConstant(objects), 4950, "a counter down from a constant");
check(whileLoop(objects), 4950, "a while loop");
check(doWhileLoop(objects), 4950, "a do-while loop");
check(twoCounters(objects), 5050, "two counters");
check(nested(rows), 450, "one loop in another");
check(overHole(numbers), 4900, "an array with a hole");
check(fromAnywhere(objects, 0), 4950, "a counter from a parameter");
check(byTwo(objects), 2450, "a counter that goes up by two");
check(fromFraction(objects, 0.5), 4950, "a counter that is no integer");

if (aotTypeCoverage("fromZero") && aotRemarks("fromZero").includes("split-loop")) {
    const covers = "entry-range-covers-reentry";
    let expectations = [
        ["fromZero", "op_get_by_id", 100, true],
        ["fromOne", "op_get_by_id", 99, true],
        ["downFromConstant", "op_get_by_id", 100, true],
        ["whileLoop", "op_get_by_id", 100, true],
        ["doWhileLoop", "op_get_by_id", 100, true],
        ["twoCounters", "op_get_by_id", 100, true],
        ["nested", "op_get_by_id", 100, true],
        ["overHole", "op_get_by_val", 100, true],
        ["fromAnywhere", "op_get_by_id", 100, false],
        ["byTwo", "op_get_by_id", 50, false],
    ];
    for (let [name, opcode, timesRun, rangeIsWidened] of expectations) {
        if (!aotRemarks(name).includes("split-loop"))
            throw new Error("the loop of " + name + " is not split: " + aotRemarks(name).join(" "));
        let counters = countersOf(name, opcode);
        check(counters.timesRun, timesRun, "how often " + opcode + " runs in " + name);
        if (counters.stubCalls > 4)
            throw new Error(name + " stays in the generic copy of its loop: " + counters.stubCalls + " of " + counters.timesRun + " times");
        check(aotRemarks(name).includes(covers), rangeIsWidened, covers + " applies to " + name);
    }
    let counters = countersOf("fromFraction", "op_get_by_id");
    check(counters.timesRun, 99, "how often op_get_by_id runs in fromFraction");
    check(counters.stubCalls, 99, "a counter that is no integer stays in the generic copy");
}
console.log("passed");
