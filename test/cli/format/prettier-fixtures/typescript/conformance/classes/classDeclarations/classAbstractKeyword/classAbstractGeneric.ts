abstract class A<T> {
    t: T;

    abstract foo(): T;
    abstract bar(t: T);
}

abstract class B<T> extends A {}

class C<T> extends A {}

class D extends A {}

class E<T> extends A {
    foo() { return this.t; }
}

class F<T> extends A {
    bar(t : T) {}
}

class G<T> extends A {
    foo() { return this.t; }
    bar(t: T) { }
}