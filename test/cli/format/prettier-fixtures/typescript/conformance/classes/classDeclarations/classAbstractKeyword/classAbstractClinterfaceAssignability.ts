
var I: IConstructor;

abstract class A {
    x: number;
    static y: number;
}

var AA: typeof A;
AA = I;

var AAA: typeof I;
AAA = A;