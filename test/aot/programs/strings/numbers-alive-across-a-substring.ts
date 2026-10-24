// Numbers that are alive in registers across `slice`, `substring` and `substr`, where the string is a rope and the part is made by the run time.
function outside(text: string, a: number, b: number): string {
    const x = a * 1.5, y = b / 3, z = a - b * 0.25;
    const part = (text + a).slice(2, 9);
    return part + ":" + (x + y) + ":" + z;
}
function inLoop(texts: string[], a: number, b: number): string {
    let sum = a * 0.5, product = b + 0.125, lengths = 0;
    const parts: string[] = [];
    for (let i = 0; i < texts.length; i++) {
        const part = (texts[i] + i).substring(1, 7);
        sum += product * 0.5;
        product -= sum / 7;
        lengths += part.length;
        parts.push(part);
    }
    return parts.join() + ":" + sum + ":" + product + ":" + lengths;
}
function many(text: string, n: number): number {
    let a = n + 0.1, b = n + 0.2, c = n + 0.3, d = n + 0.4, e = n + 0.5, f = n + 0.6, g = n + 0.7, h = n + 0.8;
    let total = 0;
    for (let i = 0; i < 20; i++) {
        total += (text + i + text).substr(3, 11).length;
        a += b; b += c; c += d; d += e; e += f; f += g; g += h; h += a * 1e-9;
    }
    return total + a + b + c + d + e + f + g + h;
}
const lines: string[] = [];
for (let round = 0; round < 5; round++) {
    lines.push(outside("a longer word ", round + 0.5, round * 3), inLoop(["first word ", "second ", "", "日本語の言葉 ", "x"], round, round + 1), String(many("some text ", round)));
}
console.log(lines.join("\n"));
