enum Color { Red = 1, Green = 2 }

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

literals();
enums();
