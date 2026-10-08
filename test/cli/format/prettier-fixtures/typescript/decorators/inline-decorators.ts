
@d1
@d2(foo)
@d3.bar
@d4.baz()
class Class1 {}

class Class2 {
    @d1
    @d2(foo)
    @d3.bar
    @d4.baz()
    method1() {}

    @d1
    method2() {}

    @d2(foo)
    method3() {}

    @d3.bar
    method4() {}
}

class Class3 {
    @d1 fieldA;
    @d2(foo) fieldB;
    @d3.bar fieldC;
    @d4.baz() fieldD;

    constructor (
        @d1 private x: number,
        @d2(foo) private y: number,
        @d3('foo') private z: number,
        @d4({
            x: string
        }) private a: string,
    ) {}
}

@decorated class Foo {}

class Bar {
    @decorated method() {}
}

class MyContainerComponent {
  @ContentChildren(MyComponent) components: QueryListSomeBigName<MyComponentThat>;
}
