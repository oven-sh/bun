import type { int32 } from "bun";

enum Color { Red = 1, Green = 2 }

function attempt(run: () => unknown): string {
    try {
        return String(run());
    } catch (error) {
        return (error as Error).constructor.name;
    }
}

function literals(): void {
    let v: 1 | 2;
    const get = (): 1 | 2 => v;
    const take = (p: 1 | 2) => p + 1;
    const less = (p: 1 | 2) => p - 1;
    const plus = (p: 1 | 2) => +p;
    console.log(take(get()), less(get()), plus(get()));
    v = 1;
    console.log(take(get()), less(get()), plus(get()));
}

function enums(): void {
    let v: Color;
    const get = (): Color => v;
    const take = (p: Color) => p + 1;
    console.log(take(get()));
    v = Color.Green;
    console.log(take(get()));
}

function declared(): void {
    let v: int32;
    const get = (): int32 => v;
    const take = (p: int32) => p + 1;
    const twice = (p: int32) => p + p - 1;
    console.log(take(get()), twice(get()));
    v = 1;
    console.log(take(get()), twice(get()));
}

function counters(): void {
    let v: int32;
    const get = (): int32 => v;
    const count = (from: int32, to: int32): string => {
        let turns = 0;
        for (let i: int32 = from; i < to; i++)
            turns++;
        return "turns " + turns;
    };
    const bump = (from: int32): string => {
        let at: int32 = from;
        at++;
        return "at " + at;
    };
    console.log(attempt(() => count(get(), 3)), attempt(() => count(0, get())), attempt(() => bump(get())));
    v = 1;
    console.log(attempt(() => count(get(), 3)), attempt(() => count(0, get())), attempt(() => bump(get())));
}

literals();
enums();
declared();
counters();
