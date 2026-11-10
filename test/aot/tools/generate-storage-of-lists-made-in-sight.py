#!/usr/bin/env python3
# generate-storage-of-lists-made-in-sight.py <folder>: all 140; ../parallel/storage-of-lists-made-in-sight/ holds 30 of them: those that a planted fault has turned red, and six that hold the count. One program a row: a list is made, one thing is done to it that keeps or changes its kind of storage, its holes or its length, and it is read by an index that is no constant. Each program is built alone and held against `bun <file>`.
import os, re, sys

PRELUDE = r"""const lines: string[] = [];

function text(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (value === undefined) return "undefined";
  return JSON.stringify(value);
}

function describe(list: any[]): string {
  let out = "[" + list.length + ":";
  for (let k = 0; k < list.length && k < 10; k++) out += (k in list ? text(list[k]) : "hole") + ",";
  return out + "]";
}

function show(label: string, i: number, value: unknown): void {
  lines.push(label + " " + i + " " + (Array.isArray(value) ? describe(value) : text(value)));
}
"""

HELPERS = r"""function meddle(list: any[], how: number): void {
  if (how === 1) list[1] = "meddled";
  else if (how === 2) list.length = 1;
  else if (how === 3) list.push(0.5);
  else if (how === 4) list[1] = 0.25;
  else if (how === 5) delete list[2];
}
function make(): number[] { return [1, 2, 3, 4]; }
const numbers = [5, 2.5, NaN, -0, 2147483648, -1];
const values: unknown[] = ["text", 1, 0.5, null, undefined, NaN];
"""

ROWS = [
    ('wholeNumbers', r"""function wholeNumbers(i: number) { const t = [10, 20, 30, 40]; return t[i & 3]; }""", 'wholeNumbers(i)'),
    ('wholeNumbersAnywhere', r"""function wholeNumbersAnywhere(i: number) { const t = [10, 20, 30, 40]; return t[i - 2]; }""", 'wholeNumbersAnywhere(i)'),
    ('fractions', r"""function fractions(i: number) { const t = [1.5, 2.5, 3.5, 4.5]; return t[i & 3]; }""", 'fractions(i)'),
    ('fractionsAnywhere', r"""function fractionsAnywhere(i: number) { const t = [1.5, 2.5, 3.5, 4.5]; return t[i - 2]; }""", 'fractionsAnywhere(i)'),
    ('mixed', r"""function mixed(i: number) { const t = [1, "two", null, 4.5]; return t[i & 3]; }""", 'mixed(i)'),
    ('withNaN', r"""function withNaN(i: number) { const t = [1.5, NaN, 3.5, 4.5]; return t[i & 3]; }""", 'withNaN(i)'),
    ('withNegativeZero', r"""function withNegativeZero(i: number) { const t = [0, -0, 1, 2]; return t[i & 3]; }""", 'withNegativeZero(i)'),
    ('withHole', r"""function withHole(i: number) { const t: any[] = [1, , 3, 4]; return t[i & 3]; }""", 'withHole(i)'),
    ('withHoleAmongFractions', r"""function withHoleAmongFractions(i: number) { const t: any[] = [1.5, , 3.5, 4.5]; return t[i & 3]; }""", 'withHoleAmongFractions(i)'),
    ('withUndefined', r"""function withUndefined(i: number) { const t = [1, undefined, 3, 4]; return t[i & 3]; }""", 'withUndefined(i)'),
    ('texts', r"""function texts(i: number) { const t = ["a", "b", "c", "d"]; return t[i & 3]; }""", 'texts(i)'),
    ('ofArguments', r"""function ofArguments(i: number, a: unknown, b: unknown) { const t = [a, b]; return t[i & 1]; }""", 'ofArguments(i, values[i], values[5 - i])'),
    ('ofNumbers', r"""function ofNumbers(i: number, a: number, b: number) { const t = [a, b]; return t[i & 1]; }""", 'ofNumbers(i, numbers[i], numbers[5 - i])'),
    ('added', r"""function added(i: number) { const t = [10, 20, 30, 40]; return t[i & 3] + t[(i + 1) & 3]; }""", 'added(i)'),
    ('storeWhole', r"""function storeWhole(i: number) { const t = [1, 2, 3, 4]; t[1] = 7; return t[i & 3]; }""", 'storeWhole(i)'),
    ('storeFraction', r"""function storeFraction(i: number) { const t = [1, 2, 3, 4]; t[1] = 2.5; return t[i & 3]; }""", 'storeFraction(i)'),
    ('storeNumber', r"""function storeNumber(i: number, x: number) { const t = [1, 2, 3, 4]; t[1] = x; return t[i & 3]; }""", 'storeNumber(1, numbers[i])'),
    ('storeNumberTwice', r"""function storeNumberTwice(i: number, x: number) { const t = [1, 2, 3, 4]; t[1] = 9; t[2] = x; return t[i & 3]; }""", 'storeNumberTwice(2, numbers[i])'),
    ('storeText', r"""function storeText(i: number) { const t: any[] = [1, 2, 3, 4]; t[2] = "two"; return t[i & 3]; }""", 'storeText(i)'),
    ('storeIntoFractions', r"""function storeIntoFractions(i: number, x: number) { const t = [1.5, 2.5, 3.5, 4.5]; t[0] = 0.5; t[3] = x; return t[i & 3]; }""", 'storeIntoFractions(3, numbers[i])'),
    ('storeUndefined', r"""function storeUndefined(i: number) { const t: any[] = [1, 2, 3, 4]; t[1] = undefined; return t[i & 3]; }""", 'storeUndefined(i)'),
    ('storeAtEnd', r"""function storeAtEnd(i: number) { const t = [1, 2]; t[2] = 3; t[3] = 4; return [t[i & 3], t.length]; }""", 'storeAtEnd(i)'),
    ('storeBeyond', r"""function storeBeyond(i: number) { const t: any[] = [1, 2]; t[4] = 5; return [t[i & 3], t[4], t.length]; }""", 'storeBeyond(i)'),
    ('storeBeyondThenInside', r"""function storeBeyondThenInside(i: number) { const t: any[] = ["a", "b"]; t[4] = "e"; t[3] = "d"; return [t[i & 3], t.length]; }""", 'storeBeyondThenInside(i)'),
    ('storeFar', r"""function storeFar(i: number) { const t: any[] = [1, 2]; t[5000] = 9; t[0] = 8; return [t[i & 1], t[5000], t.length]; }""", 'storeFar(i)'),
    ('storeVeryFar', r"""function storeVeryFar(i: number) { const t: any[] = ["a", "b"]; t[200000] = "z"; t[1] = "y"; return [t[i & 1], t[200000], t.length]; }""", 'storeVeryFar(i)'),
    ('storeAtIndex', r"""function storeAtIndex(i: number) { const t: any[] = [0, 0, 0, 0]; t[i & 3] = i; t[(i + 1) & 3] = "s"; return t; }""", 'storeAtIndex(i)'),
    ('storeIntoShared', r"""function storeIntoShared(i: number) { const t = [1, 2, 3]; t[i % 3] = 7; return t; }""", 'storeIntoShared(i)'),
    ('storeThenLength', r"""function storeThenLength(i: number, a: unknown) { const t = [a]; t[1] = a; t[2] = a; return [t.length, t[i % 3]]; }""", 'storeThenLength(i, values[i])'),
    ('popped', r"""function popped(i: number) { const t = [1, 2, 3, 4]; t.pop(); return t[i & 3]; }""", 'popped(i)'),
    ('shifted', r"""function shifted(i: number) { const t = [1, 2, 3, 4]; t.shift(); return t[i & 3]; }""", 'shifted(i)'),
    ('unshifted', r"""function unshifted(i: number) { const t = [1, 2, 3, 4]; t.unshift(0.5); return t[i & 3]; }""", 'unshifted(i)'),
    ('spliced', r"""function spliced(i: number) { const t: any[] = [1, 2, 3, 4]; t.splice(1, 1, "in"); return t[i & 3]; }""", 'spliced(i)'),
    ('reversed', r"""function reversed(i: number) { const t = [1, 2, 3, 4]; t.reverse(); return t[i & 3]; }""", 'reversed(i)'),
    ('sorted', r"""function sorted(i: number) { const t = [3, 1, 4, 2]; t.sort(); return t[i & 3]; }""", 'sorted(i)'),
    ('sortedByOrder', r"""function sortedByOrder(i: number) { const t = [3.5, 1.5, 4.5, 2.5]; t.sort((left, right) => right - left); return t[i & 3]; }""", 'sortedByOrder(i)'),
    ('filled', r"""function filled(i: number, x: unknown) { const t: any[] = [1, 2, 3, 4]; t.fill(x); return t[i & 3]; }""", 'filled(i, values[i])'),
    ('copiedWithin', r"""function copiedWithin(i: number) { const t = [1, 2, 3, 4]; t.copyWithin(0, 2); return t[i & 3]; }""", 'copiedWithin(i)'),
    ('cut', r"""function cut(i: number) { const t = [1, 2, 3, 4]; t.length = 2; return t[i & 3]; }""", 'cut(i)'),
    ('stretched', r"""function stretched(i: number) { const t = [1, 2, 3, 4]; t.length = 6; return [t[(i & 3) + 2], t.length]; }""", 'stretched(i)'),
    ('deleted', r"""function deleted(i: number) { const t: any[] = [1, 2, 3, 4]; delete t[1]; return t[i & 3]; }""", 'deleted(i)'),
    ('searched', r"""function searched(i: number) { const t = [10, 20, 30, 40]; return [t.indexOf(i * 10), t.includes(i * 10), t.lastIndexOf(20)]; }""", 'searched(i)'),
    ('searchedForNaN', r"""function searchedForNaN(i: number) { const t = [1.5, NaN, 3.5]; return [t.indexOf(NaN), t.includes(NaN), t[i % 3]]; }""", 'searchedForNaN(i)'),
    ('joined', r"""function joined(i: number) { const t = [1, 2.5, "x", null]; return t.join(String(i)); }""", 'joined(i)'),
    ('sliced', r"""function sliced(i: number) { const t = [1, 2, 3, 4]; const u = t.slice(1); u[0] = 2.5; return [t[i & 3], u[i % 3]]; }""", 'sliced(i)'),
    ('spread', r"""function spread(i: number) { const t = [1, 2, 3, 4]; t[i & 3] = 9; return Math.max(...t); }""", 'spread(i)'),
    ('takenApart', r"""function takenApart(i: number) { const t = [1, 2, 3, 4]; t[1] = i; const [first, second] = t; return first + second; }""", 'takenApart(i)'),
    ('frozen', r"""function frozen(i: number) { const t = [1, 2, 3, 4]; Object.freeze(t); try { t[1] = 9; } catch { return "refused " + t[i & 3]; } return t[i & 3]; }""", 'frozen(i)'),
    ('sealed', r"""function sealed(i: number) { const t = [1, 2, 3, 4]; Object.seal(t); t[1] = 9; try { t[4] = 5; } catch { return "refused " + t[i & 3]; } return t[i & 3]; }""", 'sealed(i)'),
    ('closed', r"""function closed(i: number) { const t = [1, 2, 3, 4]; Object.preventExtensions(t); t[1] = 9; try { t.push(5); } catch { return "refused " + t[i & 3]; } return t[i & 3]; }""", 'closed(i)'),
    ('frozenThenPushed', r"""function frozenThenPushed(i: number) { const t: any[] = []; t.push(i); Object.freeze(t); try { t.push(i); } catch { return "refused " + t.length; } return t.length; }""", 'frozenThenPushed(i)'),
    ('withGetter', r"""function withGetter(i: number) { const t: any[] = [1, 2, 3, 4]; Object.defineProperty(t, 1, { get() { return "got"; } }); return t[i & 3]; }""", 'withGetter(i)'),
    ('withFixedElement', r"""function withFixedElement(i: number) { const t = [1, 2, 3, 4]; Object.defineProperty(t, 1, { value: 7, writable: false }); try { t[1] = 9; } catch { return "refused " + t[i & 3]; } return t[i & 3]; }""", 'withFixedElement(i)'),
    ('belowAnother', r"""function belowAnother(i: number) { const above: any = Object.create(Array.prototype); above[1] = "above"; const t: any[] = [1, , 3, 4]; Object.setPrototypeOf(t, above); return t[i & 3]; }""", 'belowAnother(i)'),
    ('withName', r"""function withName(i: number) { const t: any = [1, 2, 3, 4]; t.label = "named"; t[1] = 2.5; return [t[i & 3], t.label]; }""", 'withName(i)'),
    ('pushedTexts', r"""function pushedTexts(i: number) { const t: string[] = []; t.push("a"); t.push("b"); return t[i & 1]; }""", 'pushedTexts(i)'),
    ('pushedWhole', r"""function pushedWhole(i: number) { const t: number[] = []; t.push(1); t.push(2); return t[i & 1]; }""", 'pushedWhole(i)'),
    ('pushedFractions', r"""function pushedFractions(i: number) { const t: number[] = []; t.push(1.5); t.push(2.5); return t[i & 1]; }""", 'pushedFractions(i)'),
    ('pushedOfEveryKind', r"""function pushedOfEveryKind(i: number) { const t: any[] = []; t.push(1); t.push(1.5); t.push("x"); t.push(2); return [t[i & 3], t.length]; }""", 'pushedOfEveryKind(i)'),
    ('pushedNumber', r"""function pushedNumber(i: number, x: number) { const t: number[] = []; t.push(x); t.push(1); return t[i & 1]; }""", 'pushedNumber(0, numbers[i])'),
    ('pushedOntoConstants', r"""function pushedOntoConstants(i: number) { const t: any[] = [1, 2]; t.push("x"); t.push(3); return [t[i & 3], t.length]; }""", 'pushedOntoConstants(i)'),
    ('pushedOntoShared', r"""function pushedOntoShared(i: number) { const t = [1, 2]; t.push(i); return t; }""", 'pushedOntoShared(i)'),
    ('pushedNaN', r"""function pushedNaN(i: number) { const t = [1.5]; t.push(NaN); t.push(2.5); return t[i % 3]; }""", 'pushedNaN(i)'),
    ('pushedThenStored', r"""function pushedThenStored(i: number) { const t: any[] = []; t.push("a"); t.push("b"); t[0] = "c"; t[i & 1] = i; return t; }""", 'pushedThenStored(i)'),
    ('pushedAndCounted', r"""function pushedAndCounted(i: number) { const t: any[] = []; const first = t.push(i); const second = t.push(i); return first + second + t.length; }""", 'pushedAndCounted(i)'),
    ('pushedWithOwnPush', r"""function pushedWithOwnPush(i: number) { const t: any = []; t.push = function (this: any, value: unknown) { this[0] = "own " + value; }; t.push(i); return t[0]; }""", 'pushedWithOwnPush(i)'),
    ('pushedBehindHole', r"""function pushedBehindHole(i: number) { const t: any[] = [1, , 3]; t.push(4); return t[i & 3]; }""", 'pushedBehindHole(i)'),
    ('sumInLoop', r"""function sumInLoop(n: number) { const t = [1, 2, 3, 4]; let sum = 0; for (let k = 0; k < n; k++) sum += t[k & 3]; return sum; }""", 'sumInLoop(i * 3)'),
    ('sumOfFractionsInLoop', r"""function sumOfFractionsInLoop(n: number) { const t = [1.5, 2.5, 3.5, 4.5]; let sum = 0; for (let k = 0; k < n; k++) sum += t[k & 3]; return sum; }""", 'sumOfFractionsInLoop(i * 3)'),
    ('fillInLoop', r"""function fillInLoop(n: number) { const t = [0, 0, 0, 0]; for (let k = 0; k < n; k++) t[k & 3] = k; return t; }""", 'fillInLoop(i * 2)'),
    ('growInLoop', r"""function growInLoop(n: number) { const t: number[] = []; for (let k = 0; k < n; k++) t[k] = k * 0.5; return [t.length, t[n >> 1], t[n - 1], t[n]]; }""", 'growInLoop(i * 400 + 1)'),
    ('pushInLoop', r"""function pushInLoop(n: number) { const t: number[] = []; for (let k = 0; k < n; k++) t.push(k); return [t.length, t[n >> 1], t[n - 1], t[n]]; }""", 'pushInLoop(i * 400 + 1)'),
    ('pushTextsInLoop', r"""function pushTextsInLoop(n: number) { const t: string[] = []; for (let k = 0; k < n; k++) t.push("t" + k); return [t.length, t[n >> 1], t[n]]; }""", 'pushTextsInLoop(i * 400 + 1)'),
    ('madeInLoop', r"""function madeInLoop(n: number) { let sum = 0; for (let k = 0; k < n; k++) { const pair = [k, k + 0.5]; pair[0] = pair[1]; sum += pair[k & 1]; } return sum; }""", 'madeInLoop(i * 3)'),
    ('kindChangesInLoop', r"""function kindChangesInLoop(n: number) { const t: any[] = [1, 2, 3, 4]; let out = ""; for (let k = 0; k < n; k++) { out += text(t[k & 3]); t[(k + 1) & 3] = k === 1 ? "x" : k === 2 ? 0.5 : k; } return out; }""", 'kindChangesInLoop(i * 2)'),
    ('holeComesInLoop', r"""function holeComesInLoop(n: number) { const t: any[] = [1, 2, 3, 4]; let out = ""; for (let k = 0; k < n; k++) { out += text(t[k & 3]); if (k === 2) delete t[3]; } return out; }""", 'holeComesInLoop(i * 2)'),
    ('handedOn', r"""function handedOn(i: number) { const t: any[] = [1, 2, 3, 4]; meddle(t, i); return t[(i + 1) & 3]; }""", 'handedOn(i)'),
    ('handedOnAndBack', r"""function handedOnAndBack(i: number) { const t: any[] = [1, 2, 3, 4]; const before = t[i & 3]; meddle(t, i); t[0] = 5; return [before, t[i & 3], t.length]; }""", 'handedOnAndBack(i)'),
    ('madeElsewhere', r"""function madeElsewhere(i: number) { const t = make(); t[1] = 2.5; return t[i & 3]; }""", 'madeElsewhere(i)'),
    ('captured', r"""function captured(i: number) { const t: any[] = [1, 2, 3]; const change = () => { t[0] = "changed"; }; change(); return t[i % 3]; }""", 'captured(i)'),
    ('twoNames', r"""function twoNames(i: number) { const t: any[] = [1, 2, 3, 4]; const u = t; u[1] = "other name"; return t[i & 3]; }""", 'twoNames(i)'),
    ('oneOfTwo', r"""function oneOfTwo(i: number) { const t: any[] = i & 1 ? [1, 2, 3, 4] : ["a", "b", "c", "d"]; t[0] = 0.5; return t[i & 3]; }""", 'oneOfTwo(i)'),
    ('storedOnOneWay', r"""function storedOnOneWay(i: number) { const t: any[] = [1, 2, 3, 4]; if (i & 1) t[2] = "one way"; return t[i & 3]; }""", 'storedOnOneWay(i)'),
    ('stepped', r"""function* stepped(i: number) { const t = [1, 2, 3, 4]; yield t[i & 3]; t[1] = 2.5; yield t[i & 3]; t.push(5); yield t[(i & 3) + 1]; }""", 'Array.from(stepped(i))'),
    ('awaited', r"""async function awaited(i: number) { const t: any[] = [1, 2, 3, 4]; const before = t[i & 3]; await null; t[2] = "later"; await null; return [before, t[i & 3]]; }""", 'await awaited(i)'),
    ('pushedFractionOntoWhole', r"""function pushedFractionOntoWhole(i: number) { const t = [1, 2, 3, 4]; t.push(0.5); return t[i & 3] + t[4]; }""", 'pushedFractionOntoWhole(i)'),
    ('pushedTextOntoFractions', r"""function pushedTextOntoFractions(i: number) { const t: any[] = [1.5, 2.5, 3.5, 4.5]; t.push("x"); return [t[i & 3], t[4]]; }""", 'pushedTextOntoFractions(i)'),
    ('pushedOntoMade', r"""function pushedOntoMade(i: number, a: number) { const t: any[] = [a | 0, 2, 3, 4]; t.push(a); return [t[i & 3], t[4]]; }""", 'pushedOntoMade(i, numbers[i])'),
    ('readThenPushedInLoop', r"""function readThenPushedInLoop(n: number) { const t: any[] = [1, 2, 3, 4]; let out = ""; for (let k = 0; k < n; k++) { out += text(t[k & 3]) + ","; t.push(k === 1 ? 0.5 : k === 3 ? "x" : k); } return out + t.length; }""", 'readThenPushedInLoop(i * 2)'),
    ('readThenCutInLoop', r"""function readThenCutInLoop(n: number) { const t = [1, 2, 3, 4]; let out = ""; for (let k = 0; k < n; k++) { out += text(t[k & 3]) + ","; if (k === 2) t.length = 1; } return out; }""", 'readThenCutInLoop(i * 2)'),
    ('readThenPoppedInLoop', r"""function readThenPoppedInLoop(n: number) { const t = ["a", "b", "c", "d"]; let out = ""; for (let k = 0; k < n; k++) { out += text(t[k & 3]) + ","; if (k & 1) t.pop(); } return out; }""", 'readThenPoppedInLoop(i * 2)'),
    ('readThenShiftedInLoop', r"""function readThenShiftedInLoop(n: number) { const t = [1.5, 2.5, 3.5, 4.5]; let out = ""; for (let k = 0; k < n; k++) { out += text(t[k & 3]) + ","; if (k === 1) t.shift(); } return out; }""", 'readThenShiftedInLoop(i * 2)'),
    ('readThenFilledInLoop', r"""function readThenFilledInLoop(n: number, x: unknown) { const t: any[] = [1, 2, 3, 4]; let out = ""; for (let k = 0; k < n; k++) { out += text(t[k & 3]) + ","; if (k === 2) t.fill(x); } return out; }""", 'readThenFilledInLoop(8, values[i])'),
    ('changedInInnerLoop', r"""function changedInInnerLoop(n: number) { const t: any[] = [1, 2, 3, 4]; let out = ""; for (let k = 0; k < n; k++) { out += text(t[k & 3]) + ","; for (let j = 0; j < k; j++) if (j === 2) t.splice(1, 1, "in"); } return out; }""", 'changedInInnerLoop(i + 2)'),
    ('changedOnOneWayByPush', r"""function changedOnOneWayByPush(i: number) { const t: any[] = [1, 2, 3, 4]; if (i & 1) t.unshift(0.5); return [t[i & 3], t.length]; }""", 'changedOnOneWayByPush(i)'),
    ('cutOnOneWay', r"""function cutOnOneWay(i: number) { const t = ["a", "b", "c", "d"]; if (i & 2) t.length = 1; return t[i & 3]; }""", 'cutOnOneWay(i)'),
    ('changedInTry', r"""function changedInTry(i: number) { const t: any[] = [1, 2, 3, 4]; try { t.pop(); if (i & 1) throw new Error("left"); t.pop(); } catch { return "caught " + text(t[i & 3]); } return t[i & 3]; }""", 'changedInTry(i)'),
    ('changedInFinally', r"""function changedInFinally(i: number) { const t: any[] = [1, 2, 3, 4]; try { if (i & 1) return t[i & 3]; } finally { t.reverse(); t.push("last"); } return [t[i & 3], t[4]]; }""", 'changedInFinally(i)'),
    ('changedByComparison', r"""function changedByComparison(i: number) { const t: any[] = [3, 1, 4, 2]; t.sort((left, right) => { if (t.length < 6) t.push(0.5); return left - right; }); return [t[i & 3], t.length]; }""", 'changedByComparison(i)'),
    ('changedByCallback', r"""function changedByCallback(i: number) { const t: any[] = [1, 2, 3, 4]; t.forEach((value, k) => { if (k === 1) t[3] = "set " + value; if (k === 2) t.length = 3; }); return t[i & 3]; }""", 'changedByCallback(i)'),
    ('changedByConversion', r"""function changedByConversion(i: number) { const t: any[] = [1, 2, 3, 4]; const key = { valueOf() { t.length = 1; return i & 3; } }; return [t[+key], t[i & 3]]; }""", 'changedByConversion(i)'),
    ('changedByGetterOfAnother', r"""function changedByGetterOfAnother(i: number) { const t: any[] = [1, 2, 3, 4]; const other = { get now() { t.shift(); t.push("pushed"); return 0; } }; const before = t[i & 3]; return [before, other.now, t[i & 3]]; }""", 'changedByGetterOfAnother(i)'),
    ('setByReflect', r"""function setByReflect(i: number) { const t: any[] = [1, 2, 3, 4]; Reflect.set(t, 1, "set"); Reflect.set(t, "length", 3); return t[i & 3]; }""", 'setByReflect(i)'),
    ('deletedByReflect', r"""function deletedByReflect(i: number) { const t: any[] = ["a", "b", "c", "d"]; Reflect.deleteProperty(t, 2); return t[i & 3]; }""", 'deletedByReflect(i)'),
    ('definedByReflect', r"""function definedByReflect(i: number) { const t: any[] = [1, 2, 3, 4]; Reflect.defineProperty(t, 2, { get() { return "got"; } }); return t[i & 3]; }""", 'definedByReflect(i)'),
    ('assignedOver', r"""function assignedOver(i: number) { const t: any[] = [1, 2, 3, 4]; Object.assign(t, { 1: "over", 5: 0.5 }); return [t[i & 3], t.length]; }""", 'assignedOver(i)'),
    ('pushedByCall', r"""function pushedByCall(i: number) { const t: any[] = [1, 2, 3, 4]; Array.prototype.push.call(t, 0.5); Array.prototype.shift.call(t); return t[i & 3]; }""", 'pushedByCall(i)'),
    ('pushedByKey', r"""function pushedByKey(i: number, name: string) { const t: any = [1, 2, 3, 4]; t[name](); return t[i & 3]; }""", 'pushedByKey(i, i & 1 ? "pop" : "reverse")'),
    ('swappedByPattern', r"""function swappedByPattern(i: number) { const t: any[] = [1, 2, 3, 4]; [t[0], t[3]] = [t[3], "first"]; return t[i & 3]; }""", 'swappedByPattern(i)'),
    ('lengthByPattern', r"""function lengthByPattern(i: number) { const t = [1, 2, 3, 4]; ({ length: t.length } = { length: 2 }); return t[i & 3]; }""", 'lengthByPattern(i)'),
    ('belowAnotherWithoutHoles', r"""function belowAnotherWithoutHoles(i: number) { const above: any = Object.create(Array.prototype); above[5] = "above"; const t: any[] = [1, 2, 3, 4]; Object.setPrototypeOf(t, above); return [t[i & 3], t[(i & 3) + 2]]; }""", 'belowAnotherWithoutHoles(i)'),
    ('heldByAnObject', r"""function heldByAnObject(i: number) { const t: any[] = [1, 2, 3, 4]; const holder = { list: t }; holder.list.pop(); holder.list[0] = "held"; return t[i & 3]; }""", 'heldByAnObject(i)'),
    ('heldByAList', r"""function heldByAList(i: number) { const t: any[] = [1, 2, 3, 4]; const outer = [t, t]; outer[i & 1].length = 2; return [t[i & 3], outer[1][i & 3]]; }""", 'heldByAList(i)'),
    ('listOfLists', r"""function listOfLists(i: number) { const rows: any[][] = [[1, 2], [3.5, 4.5], ["a", "b"]]; rows[1].push("x"); return [rows[i % 3][i & 1], rows[1][2]]; }""", 'listOfLists(i)'),
    ('givenBackByItsOwnMethod', r"""function givenBackByItsOwnMethod(i: number) { const t: any[] = [4, 3, 2, 1]; const u = t.sort(); u.push(0.5); u.shift(); return t[i & 3]; }""", 'givenBackByItsOwnMethod(i)'),
    ('changedBehindAwait', r"""async function changedBehindAwait(i: number) { const t: any[] = [1, 2, 3, 4]; const late = Promise.resolve().then(() => { t.length = 1; }); const before = t[i & 3]; await late; return [before, t[i & 3]]; }""", 'await changedBehindAwait(i)'),
    ('changedBetweenSteps', r"""function* changedBetweenStepsOf(t: any[], i: number) { yield t[i & 3]; yield t[i & 3]; }
function changedBetweenSteps(i: number) { const t: any[] = [1, 2, 3, 4]; const steps = changedBetweenStepsOf(t, i); const first = steps.next().value; t.length = 1; return [first, steps.next().value]; }""", 'changedBetweenSteps(i)'),
    ('madeInGenerator', r"""function* madeInGeneratorSteps(i: number): Generator<unknown, void, (list: any[]) => void> { const t: any[] = [1, 2, 3, 4]; const change = yield t; yield t[i & 3]; change(t); yield t[i & 3]; }
function madeInGenerator(i: number) { const steps = madeInGeneratorSteps(i); const t = steps.next().value as any[]; t.pop(); const first = steps.next(list => { list.length = 1; }).value; return [first, steps.next(() => {}).value]; }""", 'madeInGenerator(i)'),
    ('readFarOutside', r"""function readFarOutside(i: number) { const t = [10, 20, 30, 40]; return [t[i * 1000000000], t[-i], t[i - 1], t[(i << 30) >>> 0]]; }""", 'readFarOutside(i)'),
    ('readAtFraction', r"""function readAtFraction(i: number) { const t = [10, 20, 30, 40]; return [t[i / 2], t[i * 0.5 + 0.5], t[-0 * i]]; }""", 'readAtFraction(i)'),
    ('readAtNumber', r"""function readAtNumber(i: number, x: number) { const t = ["a", "b", "c", "d"]; return [t[x], t[i & 3]]; }""", 'readAtNumber(i, numbers[i])'),
    ('readAtText', r"""function readAtText(i: number) { const t: any = [10, 20, 30, 40]; return [t[String(i & 3)], t["length"], t["01"]]; }""", 'readAtText(i)'),
    ('wholeNumbersOverflow', r"""function wholeNumbersOverflow(i: number) { const t = [2147483647, -2147483648, 1, -1]; return [t[i & 3] + t[(i + 2) & 3], t[i & 3] * t[i & 3], -t[i & 3]]; }""", 'wholeNumbersOverflow(i)'),
    ('largeWholeNumbers', r"""function largeWholeNumbers(i: number) { const t = [2147483648, 4294967296, -2147483649, 9007199254740991]; return t[i & 3] + 1; }""", 'largeWholeNumbers(i)'),
    ('fractionsWithInfinity', r"""function fractionsWithInfinity(i: number) { const t = [Infinity, -Infinity, 1e308, 5e-324]; return t[i & 3] * 2; }""", 'fractionsWithInfinity(i)'),
    ('undefinedAmongTexts', r"""function undefinedAmongTexts(i: number) { const t = ["a", undefined, null, "d"]; return [t[i & 3], (i & 3) in t]; }""", 'undefinedAmongTexts(i)'),
    ('madeOfAbsentArgument', r"""function madeOfAbsentArgument(i: number, a?: number, b?: string) { const t = [a, b, i]; return [t[i % 3], t.length, 1 in t]; }""", 'i & 1 ? madeOfAbsentArgument(i) : madeOfAbsentArgument(i, 1.5, "b")'),
    ('madeOfNumbersThatMayBeNaN', r"""function madeOfNumbersThatMayBeNaN(i: number, a: number, b: number) { const t: number[] = [a / b, a * b, a - b, 1.5]; return t[i & 3]; }""", 'madeOfNumbersThatMayBeNaN(i, numbers[i], numbers[5 - i])'),
    ('madeOfWholeNumbers', r"""function madeOfWholeNumbers(i: number, a: number) { const t = [a | 0, i | 0, (a + i) | 0, 7]; return t[i & 3] + t[(i + 1) & 3]; }""", 'madeOfWholeNumbers(i, numbers[i])'),
    ('madeOfObjects', r"""class Square { constructor(public side: number) {} area() { return this.side * this.side; } }
class Disk { constructor(public radius: number) {} area() { return 3 * this.radius * this.radius; } }
function madeOfObjects(n: number) { const shapes = [new Square(2), new Disk(1), new Square(3)]; let sum = 0; for (let k = 0; k < n; k++) sum += shapes[k % 3].area(); return sum; }""", 'madeOfObjects(i * 5)'),
    ('readInNestedLoops', r"""function readInNestedLoops(n: number) { const t = [1, 2, 3, 4]; const u = [0.5, 1.5]; let sum = 0; for (let k = 0; k < n; k++) for (let j = 0; j < 3; j++) sum += t[(k + j) & 3] * u[j & 1]; return sum; }""", 'readInNestedLoops(i * 3)'),
    ('readByCounterPastEnd', r"""function readByCounterPastEnd(n: number) { const t = ["a", "b", "c"]; let out = ""; for (let k = 0; k < n; k++) out += t[k]; return out; }""", 'readByCounterPastEnd(i)'),
    ('readToLength', r"""function readToLength(i: number) { const t = [1.5, 2.5, 3.5]; let sum = i; for (let k = 0; k < t.length; k++) sum += t[k]; for (let k = t.length; k >= 0; k--) sum += t[k] === undefined ? 100 : t[k]; return sum; }""", 'readToLength(i)'),
    ('oneOfTwoKinds', r"""function oneOfTwoKinds(i: number) { const t = i & 1 ? [1, 2, 3, 4] : [1.5, 2.5, 3.5, 4.5]; return t[i & 3]; }""", 'oneOfTwoKinds(i)'),
    ('oneOfTwoLengths', r"""function oneOfTwoLengths(i: number) { const t = i & 1 ? ["a", "b", "c", "d"] : ["e"]; return t[i & 3]; }""", 'oneOfTwoLengths(i)'),
    ('anotherEachTurn', r"""function anotherEachTurn(n: number) { let t: any[] = [1, 2, 3, 4]; let out = ""; for (let k = 0; k < n; k++) { out += text(t[k & 3]) + ","; t = k & 1 ? ["x"] : [0.5, , 2.5]; } return out; }""", 'anotherEachTurn(i + 1)'),
    ('copiedInLine', r"""function third(list: any[], k: number) { return list[k]; }
function shorten(list: any[]) { list.length = 2; }
function copiedInLine(i: number) { const t = [1, 2, 3, 4]; const before = third(t, i & 3); shorten(t); return [before, third(t, i & 3)]; }""", 'copiedInLine(i)'),
    ('longList', r"""function longList(i: number) { const t = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39]; return t[(i * 7) % 40] + t[i & 31]; }""", 'longList(i)'),
    ('longListMade', r"""function longListMade(i: number, a: unknown) { const t = [a, i, a, i, a, i, a, i, a, i, a, i, a, i, a, i, a, i, a, i, a, i, a, i, a, i, a, i, a, i, a, i, a, i, a, i, a, i, a, i]; return [t[(i * 7) % 40], t[i & 31]]; }""", 'longListMade(i, values[i])'),
    ('sharedStorageOfTwo', r"""function tableOfTwo(): any[] { return [1, 2, 3, 4]; }
function sharedStorageOfTwo(i: number) { const t = tableOfTwo(); const u = tableOfTwo(); t[1] = "mine"; t.pop(); return [t[i & 3], u[i & 3]]; }""", 'sharedStorageOfTwo(i)'),
]

FOUND_WITHOUT_A_TEST = { "wholeNumbers", "fractions", "texts", "sumInLoop", "madeOfObjects", "longList" }

def kebab(name):
    return re.sub(r"([A-Z])", lambda m: "-" + m.group(1).lower(), name.replace("NaN", "Nan"))

MAIN = """
async function main(): Promise<void> {
  for (let i = 0; i < 6; i++) show("LABEL", i, CALL);
  console.log(lines.join("\\n"));
}

main();
"""

folder = sys.argv[1]
os.makedirs(folder, exist_ok=True)
for label, text, call in ROWS:
    counted = "// STATISTIC: ElementReadsProvenPresent >= 1\n" if label in FOUND_WITHOUT_A_TEST else ""
    helpers = HELPERS if re.search(r"\b(meddle|make|numbers|values)\b", text + call) else ""
    open(os.path.join(folder, kebab(label) + ".ts"), "w").write(counted + PRELUDE + helpers + "\n" + text + "\n" + MAIN.replace("LABEL", label).replace("CALL", call))
print(len(ROWS), "programs")
