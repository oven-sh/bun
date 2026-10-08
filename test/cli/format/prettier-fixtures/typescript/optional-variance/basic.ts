type Covariant<out T> = {
    x: T;
}
type Contravariant<in T> = {
    f: (x: T) => void;
}
type Invariant<in out T> = {
    f: (x: T) => T;
}
type T10<out T> = T;
type T11<in T> = keyof T;
type T12<out T, out K extends keyof T> = T[K];
type T13<in out T> = T[keyof T];

type Covariant1<in T> = {
    x: T;
}

type Contravariant1<out T> = keyof T;

type Contravariant2<out T> = {
    f: (x: T) => void;
}

type Invariant1<in T> = {
    f: (x: T) => T;
}

type Invariant2<out T> = {
    f: (x: T) => T;
}
type Foo1<in T> = {
    x: T;
    f: FooFn1<T>;
}

type Foo2<out T> = {
    x: T;
    f: FooFn2<T>;
}

type Foo3<in out T> = {
    x: T;
    f: FooFn3<T>;
}

type T21<in out T> = T;

interface Baz<out T> {}
interface Baz<in T> {}

interface Parent<out A> {
    child: Child<A> | null;
    parent: Parent<A> | null;
}

declare class StateNode<TContext, in out TEvent extends { type: string }> {
    _storedEvent: TEvent;
    _action: ActionObject<TEvent>;
    _state: StateNode<TContext, any>;
}
