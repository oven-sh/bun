const show = value => Object.is(value, -0) ? "-0" : typeof value === "object" && value ? "{" + Object.keys(value).join() + "}" : typeof value === "string" ? JSON.stringify(value) : String(value);
export function readAll(row) {
    return [row.fraction, row.whole, row.flag, row.maybeFlag, row.flagOrNull, row.maybeNumber, row.numberOrNull, row.optionalNumber, row.maybeText, row.textOrNull, row.optionalText, row.maybeRecord, row.recordOrNull, row.small, row.anything].map(show).join(" ");
}
export function readInLoop(rows, turns) {
    let flags = 0, sum = 0, texts = 0, absent = 0;
    for (let turn = 0; turn < turns; turn++) {
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (row.flag) flags += i + turn;
            if (row.maybeFlag) flags += 1;
            if (row.maybeFlag === undefined) absent++;
            if (row.flagOrNull === null) absent += 2;
            const fraction = row.fraction;
            if (fraction === fraction) sum += fraction;
            sum += row.whole + row.small;
            if (row.maybeNumber !== undefined) sum += row.maybeNumber;
            if (row.maybeText === undefined) absent += 3; else texts += row.maybeText.length;
            if (row.recordOrNull === null) absent += 4;
        }
    }
    return [flags, sum, texts, absent].join(" ");
}
export function has(row) {
    return ["fraction", "flag", "maybeFlag", "optionalFlag", "optionalNumber", "optionalText"].map(name => name + ":" + (name in row) + ":" + show(row[name]) + ":" + show(row.optionalFlag)).join(" ");
}
export function kinds(row) { return [typeof row.fraction, typeof row.whole, typeof row.flag, typeof row.maybeFlag, typeof row.optionalFlag, typeof row.maybeNumber, typeof row.maybeText].join(); }
export function compute(row, a, b) { return a * row.fraction + b * row.whole + (row.flag ? a : b) + (row.maybeFlag ? b : a); }
