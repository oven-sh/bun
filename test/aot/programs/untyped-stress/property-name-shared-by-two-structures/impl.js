function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

function makesHook(i) { return { sharedState: i, hookQueue: i + 1, hookNext: null }; }
function makesNode(i) { return { nodeTag: 0, nodeKey: i + 2, sharedState: i }; }
function readsStateOfParameter(o) { return o.sharedState; }

function makesReaders() {
    let currentHook = null;
    let currentNode = null;
    let either = null;
    function setsHook(o) { currentHook = o; }
    function setsNode(o) { currentNode = o; }
    function setsEither(o) { either = o; }
    function readsStateOfHook() { return currentHook.sharedState; }
    function readsQueueOfHook() { return currentHook.hookQueue; }
    function readsNextOfHook() { return currentHook.hookNext; }
    function writesStateOfHook(v) { currentHook.sharedState = v; }
    function readsStateOfNode() { return currentNode.sharedState; }
    function readsKeyOfNode() { return currentNode.nodeKey; }
    function readsThreeOfHook() { return currentHook.sharedState + currentHook.hookQueue + (currentHook.hookNext === null ? 100 : 200); }
    function readsQueueOfEither() { return either.hookQueue; }
    function readsKeyOfEither() { return either.nodeKey; }
    function readsStateOfEither() { return either.sharedState; }
    function readsAndWritesStateOfEither() { either.sharedState = either.sharedState + 1; return either.sharedState; }
    return [setsHook, setsNode, setsEither, readsStateOfHook, readsQueueOfHook, readsNextOfHook, writesStateOfHook, readsStateOfNode, readsKeyOfNode, readsThreeOfHook, readsQueueOfEither, readsKeyOfEither, readsStateOfEither, readsAndWritesStateOfEither];
}
let [setsHook, setsNode, setsEither, readsStateOfHook, readsQueueOfHook, readsNextOfHook, writesStateOfHook, readsStateOfNode, readsKeyOfNode, readsThreeOfHook, readsQueueOfEither, readsKeyOfEither, readsStateOfEither, readsAndWritesStateOfEither] = makesReaders();

for (let i = 0; i < 100; i++) {
    setsHook(makesHook(i));
    setsNode(makesNode(i));
    check(readsStateOfHook(), i, "a name that two shapes hold, read from a variable that holds the first");
    check(readsStateOfNode(), i, "the same name, read from a variable that holds the second");
    check(readsQueueOfHook(), i + 1, "a name of the first shape alone");
    check(readsNextOfHook(), null, "another name of the first shape alone");
    check(readsKeyOfNode(), i + 2, "a name of the second shape alone");
    writesStateOfHook(i + 7);
    check(readsStateOfHook(), i + 7, "a store to the name that two shapes hold");
    check(readsThreeOfHook(), 2 * i + 108, "three fresh reads of one variable");
    check(readsStateOfParameter(makesHook(i)) + readsStateOfParameter(makesNode(i)), 2 * i, "the same name on a parameter");
    setsEither(i & 1 ? makesHook(i) : makesNode(i));
    check(readsStateOfEither(), i, "a variable that holds both shapes in turn");
    check(readsAndWritesStateOfEither(), i + 1, "reads and a store on that variable");
    check(readsQueueOfEither(), i & 1 ? i + 1 : undefined, "a name of the first shape on that variable");
    check(readsKeyOfEither(), i & 1 ? undefined : i + 2, "a name of the second shape on that variable");
}
{
    for (let i = 0; i < 100; i++) {
        setsHook(makesHook(i));
        setsNode(makesNode(i));
        readsStateOfHook();
        readsStateOfNode();
        readsQueueOfHook();
        readsKeyOfNode();
        readsThreeOfHook();
    }
}
for (let i = 0; i < 100; i++) {
    setsHook(makesNode(i));
    setsNode(makesHook(i));
    check(readsStateOfHook(), i, "the first variable holds the second shape");
    check(readsStateOfNode(), i, "the second variable holds the first shape");
    check(readsQueueOfHook(), undefined, "a name that the object in the variable lacks");
    check(readsThreeOfHook(), NaN, "three fresh reads of a variable that holds the other shape");
    writesStateOfHook(i + 7);
    check(readsStateOfHook(), i + 7, "a store to the other shape");
    setsHook(JSON.parse('{"hookNext":1,"hookQueue":' + i + ',"sharedState":' + i + '}'));
    check(readsThreeOfHook(), 2 * i + 200, "the same names in another order");
    setsHook(Object.defineProperty(makesHook(i), "sharedState", { get() { return i + 1; } }));
    check(readsThreeOfHook(), 2 * i + 102, "a getter in the place of the name");
    check(readsStateOfHook(), i + 1, "a getter read alone");
}

console.log("passed");
