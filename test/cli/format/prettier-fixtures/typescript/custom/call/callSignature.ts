interface I {
    ();
    (): void;
    <T, U>(arg: T);
    <T, U>(arg: T): U;
}

Promise.all<void>([]);
