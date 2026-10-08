
class Foo1 {
    @foo
    // comment
    async method() {}
}

class Foo2 {
    @foo
    // comment
    private method() {}
}

class Foo3 {
    @foo
    // comment
    *method() {}
}

class Foo4 {
    @foo
    // comment
    async *method() {}
}

class Something {
    @foo()
    // comment
    readonly property: Array<string>
}

class Something2 {
    @foo()
    // comment
    abstract property: Array<string>
}
