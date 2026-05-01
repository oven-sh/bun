// @bun
function doIndexOf(a) {
    a.indexOf(a);
}

function bar(f) {
    f();
}

let array = [20];
for (let i = 0; i < testLoopCount; ++i) {
    bar(() => {
        return doIndexOf(array.concat());
    });
}
