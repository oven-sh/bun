// @bun
function f() {
    return 20; 
}
noInline(f);

function bar(b) { 
    if (b)
        throw new Error("blah!");
}

function Foo(b) {
    try {
        this.value = bar(b);
    } catch(e) {
        this.value = e.toString();
    }

    f(this.value, b);
}
noInline(Foo);


for (var i = 1; i < 1000; i++) {
    let value = new Foo(i % 3 === 0);
    if (i % 3 === 0 && value.value !==  "Error: blah!")
        throw new Error("bad value: " + value.value);
}
