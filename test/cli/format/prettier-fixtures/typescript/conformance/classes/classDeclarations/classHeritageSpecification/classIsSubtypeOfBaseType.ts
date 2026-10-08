class Base<T> {
    foo: T;
}

class Derived extends Base<string> {
    foo: any;
}
