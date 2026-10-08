class A {
    foo() {}
}

abstract class B extends A {
    abstract foo();
}

abstract class AA {
    foo() {}
    abstract bar();
}

abstract class BB extends AA {
    abstract foo();
    bar () {}
}

class CC extends BB {}

class DD extends BB {
    foo() {}
}