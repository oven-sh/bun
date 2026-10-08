declare class MyArray<T> extends Array<T> {
    sort(compareFn?: (a: T, b: T) => number): this;
}
