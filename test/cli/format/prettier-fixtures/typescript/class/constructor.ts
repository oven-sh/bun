class C {constructor(override a: number) {}}
class D {constructor(private a: number) {}}
class E {constructor(protected a: number) {}}
class F {constructor(public a: number) {}}
class G {constructor(readonly a: number) {}}

class A {
    static Foo() {
        return new A()
    }
}

