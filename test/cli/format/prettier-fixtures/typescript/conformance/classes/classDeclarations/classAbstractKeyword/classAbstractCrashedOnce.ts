abstract class foo {
    protected abstract test();
}

class bar extends foo {
    test() {
    }
}
var x = new bar();