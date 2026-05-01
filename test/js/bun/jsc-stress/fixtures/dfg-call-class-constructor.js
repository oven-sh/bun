// @bun
class Foo extends Promise { }

noInline(Foo);

for (var i = 0; i < testLoopCount; ++i) {
    var completed = false;
    try {
        Foo();
        completed = true;
    } catch (e) {
    }
    if (completed)
        throw "Error: completed without throwing";
}
