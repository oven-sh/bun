class A {
}

abstract class B {
    foo(): number { return this.bar(); }
    abstract bar() : number;
}

new B;

var BB: typeof B = B;
var AA: typeof A = BB;
new AA;

function constructB(Factory : typeof B) {
    new Factory;
}

var BB = B;
new BB;

var x : any = C;
new x;

class C extends B { }

abstract class D extends B { }

class E extends B {
    bar() { return 1; }
}

abstract class F extends B {
    abstract foo() : number;
    bar() { return 2; }
}

abstract class G {
    abstract qux(x : number) : string;
    abstract qux() : number;
    y : number;
    abstract quz(x : number, y : string) : boolean;

    abstract nom(): boolean;
    nom(x : number): boolean;
}

class H {
    abstract baz() : number;
}