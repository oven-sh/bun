// A variable that holds char codes and integers, stored anew at the foot of a loop and read at its head.
const lines: string[] = [];
function show(label: string, ...values: unknown[]): void {
    lines.push(label + ": " + values.map(value => (Object.is(value, -0) ? "-0" : String(value))).join(" "));
}

function parseNumbers(text: string): number {
    let total = 0;
    let i = 0;
    let c = i < text.length ? text.charCodeAt(i) : 0;
    while (i < text.length) {
        let value = 0;
        while (c >= 48 && c <= 57) {
            value = value * 10 + (c - 48);
            i++;
            c = i < text.length ? text.charCodeAt(i) : 0;
        }
        if (c === 46) {
            i++;
            c = i < text.length ? text.charCodeAt(i) : 0;
            let scale = 0.1;
            while (c >= 48 && c <= 57) {
                value += (c - 48) * scale;
                scale *= 0.1;
                i++;
                c = i < text.length ? text.charCodeAt(i) : 0;
            }
        }
        total += value;
        i++;
        c = i < text.length ? text.charCodeAt(i) : 0;
    }
    return total;
}

function runsOffTheEnd(text: string): [number, number, boolean] {
    let i = 0;
    let c = text.charCodeAt(i);
    let digits = 0;
    while (c >= 48 && c <= 57) {
        digits++;
        c = text.charCodeAt(++i);
    }
    return [digits, c, c !== c];
}

function joinedWithFraction(text: string, at: number): number[] {
    const seen: number[] = [];
    let x = 0;
    for (let i = 0; i < text.length; i++) {
        seen.push(x < 50 ? 1 : 0, x >= 0.5 ? 1 : 0, x);
        x = i === at ? 0.5 : text.charCodeAt(i);
    }
    seen.push(x);
    return seen;
}

function joinedWithNegativeZero(text: string, at: number): unknown[] {
    const seen: unknown[] = [];
    let z = 1;
    for (let i = 0; i < text.length; i++) {
        seen.push(z, 1 / z, z < 1, z <= 0, z > -1, z >= 0);
        z = i === at ? -0 : text.charCodeAt(i) - text.charCodeAt(i);
    }
    seen.push(z);
    return seen;
}

function swapped(text: string, turns: number): number[] {
    let a = text.charCodeAt(0);
    let b = 7;
    let c = text.charCodeAt(1000);
    let below = 0;
    for (let i = 0; i < turns; i++) {
        if (a < 50) below++;
        if (c < 50 || c >= 50) below += 100;
        const held = a;
        a = b;
        b = c;
        c = held;
    }
    return [a, b, c, below];
}

function sometimesMissing(text: string): unknown[] {
    const seen: unknown[] = [];
    let u: number | undefined = undefined;
    for (let i = 0; i < text.length; i++) {
        seen.push(u, u !== undefined && u < 60, u !== undefined && u >= 60, u === undefined);
        u = i % 3 ? text.charCodeAt(i) : undefined;
    }
    seen.push(u);
    return seen;
}

function everyComparison(text: string): string {
    let out = "";
    let c = -1;
    for (let i = 0; i <= text.length + 1; i++) {
        for (const bound of [-2, -1, 0, 65, 65535, 65536]) {
            out += (c < bound ? "a" : "-") + (c <= bound ? "b" : "-") + (c > bound ? "c" : "-") + (c >= bound ? "d" : "-") + (bound < c ? "e" : "-") + (bound <= c ? "f" : "-") + (bound > c ? "g" : "-") + (bound >= c ? "h" : "-") + (c === bound ? "i" : "-") + (c !== bound ? "j" : "-");
        }
        out += "|";
        c = text.charCodeAt(i);
    }
    return out;
}

function nested(rows: string[]): number {
    let sum = 0;
    let c = 0;
    for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        for (let i = 0; i < row.length; i++) {
            if (c > 96) sum += c;
            c = row.charCodeAt(i);
        }
        if (c < 97) sum -= 1;
    }
    return sum + c;
}

show("numbers", parseNumbers("12.5 7 0.25 1000 3.125"), parseNumbers(""), parseNumbers("."), parseNumbers("9"), parseNumbers("x1y22z"));
show("off the end", ...runsOffTheEnd("123"), ...runsOffTheEnd(""), ...runsOffTheEnd("12a"), ...runsOffTheEnd("￿"));
show("fraction", ...joinedWithFraction("0Az", 1), ...joinedWithFraction("0Az", 9), ...joinedWithFraction("", 0));
show("negative zero", ...joinedWithNegativeZero("abc", 1), ...joinedWithNegativeZero("abc", 2));
show("swapped", ...swapped("A", 0), ...swapped("A", 1), ...swapped("A", 2), ...swapped("A", 3), ...swapped("0", 7), ...swapped("", 4));
show("missing", ...sometimesMissing("0Az9"), ...sometimesMissing(""));
show("comparisons", everyComparison("A\u0000￿"), everyComparison(""));
show("nested", nested(["abc", "", "XYZ", "q"]), nested([]), nested([""]));
console.log(lines.join("\n"));
