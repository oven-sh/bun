#!/usr/bin/env python3
# all 67; ../parallel/positions-in-texts/ holds 3 of them.
# Writes test/aot/parallel/positions-in-texts/: one program a shape, each held to `bun <file>` by run-parallel.ts.
# What they guard: behind `pos < text.length` the compiler reads text.charCodeAt(pos) without a test of the bounds, as an integer (aot/walk/AOTWalkPositionsInTexts.cpp, AOTWalkStringCharacters.cpp).
# A deed: a function that tests a position against a length and reads a character, and values for which the test says less than it seems to: the lower end, another text, another position, a relation that lets the end in.
# To add one: a line in `cases`: name > (what is done to what, the subject, what deed() returns). A name that ends in .cjs is sloppy, in .js has no types.
# The same bytes every time. python3 generate-positions-in-texts.py [folder]
import os, sys

TAIL = '''console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
'''

cases = {
# ---- the lower end, and what is no integer
'position-starts-below-zero.ts': ('the position starts below zero, and is below the length all the same', '''
function codes(text: string, from: number): string {
  let seen = "";
  for (let pos = from; pos < text.length; pos++) seen += text.charCodeAt(pos) + ",";
  return seen;
}''', 'codes("abc", -2) + "|" + codes("abc", 1) + "|" + codes("", -1)'),
'position-is-a-fraction.ts': ('the position goes by halves', '''
function codes(text: string, from: number): string {
  let seen = "";
  for (let pos = from; pos < text.length; pos += 0.5) seen += text.charCodeAt(pos) + "," + text.codePointAt(pos) + ";";
  return seen;
}''', 'codes("abc", 0) + "|" + codes("abc", -0.75) + "|" + codes("abc", 2.5) + "|" + codes("", -0.75)'),
'position-is-not-a-number.ts': ('the position is NaN, which is not at or behind the end', '''
function code(text: string, pos: number): string {
  if (!(pos >= text.length)) return String(text.charCodeAt(pos)) + "," + String(text.codePointAt(pos));
  return "outside";
}''', 'code("abc", NaN) + "|" + code("", NaN) + "|" + code("abc", 1) + "|" + code("abc", 3)'),
'position-is-minus-zero.ts': ('the position is -0', '''
function code(text: string, pos: number): string {
  if (pos < text.length) return String(text.charCodeAt(pos)) + "," + String(1 / pos);
  return "outside " + String(1 / pos);
}''', 'code("abc", -0) + "|" + code("", -0) + "|" + code("abc", 0)'),
'position-beyond-every-int32.ts': ('the position is 2 ** 31, 2 ** 32, 2 ** 53 and their negatives', '''
function code(text: string, pos: number): string {
  if (pos < text.length) return String(text.charCodeAt(pos));
  return "outside";
}''', '[2 ** 31, 2 ** 32, 2 ** 32 + 1, 2 ** 53, -(2 ** 31), -(2 ** 32), -(2 ** 32) + 1, -(2 ** 53), Infinity, -Infinity, 1].map(pos => code("abc", pos)).join()'),
'position-counts-down-past-zero.ts': ('the position counts down, below the length in every turn', '''
function codes(text: string): string {
  let seen = "";
  for (let pos = text.length - 1; pos < text.length && pos > -3; pos--) seen += text.charCodeAt(pos) + ",";
  return seen;
}''', 'codes("abc") + "|" + codes("")'),
'position-is-a-text.js': ('the position is a text, which the relation and the read convert each in its way', '''
function code(text, pos) {
  if (pos < text.length) return String(text.charCodeAt(pos));
  return "outside";
}''', 'code("abc", "1") + "|" + code("abc", "-1") + "|" + code("abc", "") + "|" + code("abc", "x") + "|" + code("abc", 2)'),

# ---- another text at the read than at the test
'text-is-replaced-between-the-test-and-the-read.ts': ('the variable holds a shorter text at the read than at the test', '''
function codes(text: string, other: string): string {
  let seen = "";
  for (let pos = 0; pos < 7; pos++) {
    let read = text;
    if (pos < read.length) {
      read = other;
      seen += read.charCodeAt(pos) + ",";
    }
  }
  return seen;
}''', 'codes("abcdef", "ab") + "|" + codes("ab", "abcdef")'),
'text-shrinks-in-the-turn.ts': ('the text loses its last character between two reads of one turn', '''
function codes(text: string): string {
  let seen = "";
  let pos = 0;
  while (pos < text.length) {
    seen += text.charCodeAt(pos) + ",";
    text = text.slice(0, text.length - 2);
    seen += text.charCodeAt(pos) + ";";
    pos++;
  }
  return seen;
}''', 'codes("abcdef") + "|" + codes("a")'),
'captured-text-that-a-callee-replaces.ts': ('a callee stores a shorter text to the captured variable between the test and the read', '''
let text = "abcdef";
function shorten() {
  text = "ab";
}
function code(pos: number): string {
  if (pos < text.length) {
    shorten();
    return String(text.charCodeAt(pos));
  }
  return "outside";
}
function fresh(pos: number): string {
  text = "abcdef";
  return code(pos);
}''', 'fresh(4) + "|" + fresh(1) + "|" + fresh(6)'),
'text-parameter-replaced-through-arguments.cjs': ('the parameter is stored to through `arguments` between the test and the read', '''
function code(text, pos) {
  if (pos < text.length) {
    arguments[0] = "ab";
    return String(text.charCodeAt(pos));
  }
  return "outside";
}''', 'code("abcdef", 4) + "|" + code("abcdef", 1) + "|" + code("ab", 4)'),
'position-parameter-moved-through-arguments.cjs': ('the position is stored to through `arguments` between the test and the read', '''
function code(text, pos) {
  if (pos < text.length) {
    arguments[1] = pos + 3;
    return String(text.charCodeAt(pos));
  }
  return "outside";
}''', 'code("abcdef", 4) + "|" + code("abcdef", 1) + "|" + code("ab", 4)'),
'test-of-one-text-read-of-another.ts': ('the length is that of another text', '''
function codes(first: string, second: string): string {
  let seen = "";
  for (let pos = 0; pos < first.length; pos++) seen += second.charCodeAt(pos) + ",";
  return seen;
}''', 'codes("abcdef", "ab") + "|" + codes("ab", "abcdef") + "|" + codes("abc", "")'),
'test-of-the-second-text-read-of-the-first.ts': ('the same, and the text that is read is the one that is named first', '''
function codes(first: string, second: string): string {
  let seen = "";
  for (let pos = 0; pos < second.length; pos++) seen += first.charCodeAt(pos) + ",";
  return seen;
}''', 'codes("ab", "abcdef") + "|" + codes("abcdef", "ab") + "|" + codes("", "abc")'),
'test-of-a-list-read-of-a-text.ts': ('the length is that of a list', '''
function codes(list: number[], text: string): string {
  let seen = "";
  for (let pos = 0; pos < list.length; pos++) seen += text.charCodeAt(pos) + ",";
  return seen;
}''', 'codes([1, 2, 3, 4, 5], "ab") + "|" + codes([1], "ab") + "|" + codes([], "ab")'),
'end-kept-of-a-text-that-is-replaced.ts': ('the end was read off the text that the variable held before', '''
function codes(text: string, other: string): string {
  const end = text.length;
  text = other;
  let seen = "";
  for (let pos = 0; pos < end; pos++) seen += text.charCodeAt(pos) + ",";
  return seen;
}''', 'codes("abcd", "ab") + "|" + codes("ab", "abcd")'),

# ---- another position at the read than at the test
'position-steps-in-the-read.ts': ('`pos++` stands in the read, and a second read follows', '''
function codes(text: string): string {
  let seen = "";
  let pos = 0;
  while (pos < text.length) seen += text.charCodeAt(pos++) + "," + text.charCodeAt(pos) + ";";
  return seen;
}''', 'codes("abc") + "|" + codes("")'),
'position-steps-in-front-of-the-read.ts': ('`++pos` stands in the read', '''
function codes(text: string): string {
  let seen = "";
  let pos = -1;
  while (pos < text.length) seen += text.charCodeAt(++pos) + ",";
  return seen;
}''', 'codes("abc") + "|" + codes("")'),
'captured-position-that-a-callee-moves.ts': ('a callee moves the captured position between the test and the read', '''
let pos = 0;
function skip() {
  pos += 3;
}
function code(text: string, from: number): string {
  pos = from;
  if (pos < text.length) {
    skip();
    return String(text.charCodeAt(pos));
  }
  return "outside";
}''', 'code("abcdef", 4) + "|" + code("abcdef", 1) + "|" + code("ab", 4)'),
'position-plus-one-behind-the-test.ts': ('the read is one behind the position that was tested', '''
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos < text.length; pos++) seen += text.charCodeAt(pos + 1) + "," + text.codePointAt(pos + 1) + ";";
  return seen;
}''', 'codes("abc") + "|" + codes("a")'),
'loop-inside-moves-the-position.ts': ('a loop inside runs the position to the end, and the read behind it has no test', '''
function codes(text: string): string {
  let seen = "";
  let pos = 0;
  while (pos < text.length) {
    while (text.charCodeAt(pos) === 32) pos++;
    seen += text.charCodeAt(pos) + ",";
    pos++;
  }
  return seen;
}''', 'codes("a b") + "|" + codes("ab  ") + "|" + codes(" ")'),

# ---- what the relation says
'at-most-the-length.ts': ('`<=` lets the end in', '''
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos <= text.length; pos++) seen += text.charCodeAt(pos) + "," + text.codePointAt(pos) + ";";
  return seen;
}''', 'codes("abc") + "|" + codes("")'),
'not-equal-to-the-length.ts': ('`!==` is passed by a step of two', '''
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos !== text.length && seen.length < 40; pos += 2) seen += text.charCodeAt(pos) + ",";
  return seen;
}''', 'codes("abcd") + "|" + codes("abc")'),
'below-the-length-less-one.ts': ('`pos < text.length - 1`: the position and the one behind it lie inside', '''
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos < text.length - 1; pos++) seen += text.charCodeAt(pos) + "," + text.charCodeAt(pos + 1) + "," + text.charCodeAt(pos + 2) + ";";
  return seen;
}''', 'codes("abc") + "|" + codes("a") + "|" + codes("")'),
'at-most-the-length-less-one.ts': ('`pos <= text.length - 1`', '''
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos <= text.length - 1; pos++) seen += text.charCodeAt(pos) + "," + text.codePointAt(pos) + ";";
  return seen;
}''', 'codes("abc") + "|" + codes("")'),
'at-most-the-length-less-zero.ts': ('`pos <= text.length - 0` lets the end in', '''
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos <= text.length - 0; pos++) seen += text.charCodeAt(pos) + ",";
  return seen;
}''', 'codes("abc") + "|" + codes("")'),
'below-the-length-plus-one.ts': ('`pos < text.length + 1` lets the end in', '''
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos < text.length + 1; pos++) seen += text.charCodeAt(pos) + ",";
  return seen;
}''', 'codes("abc") + "|" + codes("")'),
'below-the-length-less-a-negative.ts': ('`pos < text.length - -1` lets the end in', '''
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos < text.length - -1; pos++) seen += text.charCodeAt(pos) + ",";
  return seen;
}''', 'codes("abc") + "|" + codes("")'),
'below-one-less-the-length.ts': ('`pos < 9 - text.length`: the length is what is taken away', '''
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos < 9 - text.length; pos++) seen += text.charCodeAt(pos) + ",";
  return seen;
}''', 'codes("abc") + "|" + codes("abcdefgh")'),
'at-most-the-length-less-a-half.ts': ('`pos <= text.length - 0.5`', '''
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos <= text.length - 0.5; pos++) seen += text.charCodeAt(pos) + ",";
  return seen;
}''', 'codes("abc") + "|" + codes("")'),
'length-on-the-left.ts': ('`text.length > pos`', '''
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; text.length > pos; pos++) seen += text.charCodeAt(pos) + "," + text.codePointAt(pos) + ";";
  return seen;
}''', 'codes("abc") + "|" + codes("")'),
'length-on-the-left-or-equal.ts': ('`text.length >= pos` lets the end in', '''
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; text.length >= pos; pos++) seen += text.charCodeAt(pos) + ",";
  return seen;
}''', 'codes("abc") + "|" + codes("")'),
'position-above-the-length.ts': ('`pos > text.length` has passed, and has failed', '''
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos < 7; pos++) {
    if (pos > text.length) seen += "above " + text.charCodeAt(pos) + ",";
    else seen += "not above " + text.charCodeAt(pos) + ",";
  }
  return seen;
}''', 'codes("abc") + "|" + codes("")'),
'end-kept-in-a-constant.ts': ('`const end = text.length`', '''
function codes(text: string): string {
  const end = text.length;
  let seen = "";
  for (let pos = 0; pos < end; pos++) seen += text.charCodeAt(pos) + "," + text.codePointAt(pos) + ";";
  return seen;
}''', 'codes("abc") + "|" + codes("")'),
'end-kept-in-a-variable-that-grows.ts': ('the end is a variable, and one turn raises it', '''
function codes(text: string): string {
  let end = text.length;
  let seen = "";
  for (let pos = 0; pos < end; pos++) {
    seen += text.charCodeAt(pos) + ",";
    if (pos === 1 && end === text.length) end += 2;
  }
  return seen;
}''', 'codes("abc") + "|" + codes("a")'),
'break-at-the-end.ts': ('`while (true) { if (pos >= end) break; .. }`', '''
function codes(text: string): string {
  const end = text.length;
  let seen = "";
  let pos = 0;
  while (true) {
    if (pos >= end) break;
    seen += text.charCodeAt(pos) + ",";
    pos++;
  }
  return seen + text.charCodeAt(pos);
}''', 'codes("abc") + "|" + codes("")'),
'break-behind-the-end.ts': ('`if (pos > end) break` lets the end in', '''
function codes(text: string): string {
  const end = text.length;
  let seen = "";
  let pos = 0;
  while (true) {
    if (pos > end) break;
    seen += text.charCodeAt(pos) + ",";
    pos++;
  }
  return seen;
}''', 'codes("abc") + "|" + codes("")'),
'test-in-a-helper.ts': ('the test stands in a function of its own', '''
function isInside(text: string, pos: number): boolean {
  return pos < text.length;
}
function codes(text: string, other: string): string {
  let seen = "";
  for (let pos = 0; isInside(text, pos); pos++) seen += text.charCodeAt(pos) + "," + other.charCodeAt(pos) + ";";
  return seen;
}''', 'codes("abc", "a") + "|" + codes("", "a")'),
'test-that-is-negated.ts': ('`!(pos < text.length)` and `!(pos >= text.length)`', '''
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos < 7; pos++) {
    if (!(pos < text.length)) seen += "outside " + text.charCodeAt(pos) + ",";
    else if (!(pos >= text.length)) seen += "inside " + text.charCodeAt(pos) + ",";
  }
  return seen;
}''', 'codes("abc") + "|" + codes("")'),
'negated-outcome-kept-in-a-constant.ts': ('`const isOutside = !(pos < text.length)` is what is asked', '''
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos < 7; pos++) {
    const isOutside = !(pos < text.length);
    if (isOutside) seen += "outside " + text.charCodeAt(pos) + ",";
    else seen += "inside " + text.charCodeAt(pos) + ",";
  }
  return seen;
}''', 'codes("abc") + "|" + codes("")'),
'test-kept-in-a-variable.ts': ('the outcome of the test is kept, and the position moves before it is asked', '''
function codes(text: string): string {
  let seen = "";
  for (let from = 0; from < 5; from++) {
    let pos = from;
    const isInside = pos < text.length;
    pos += 2;
    if (isInside) seen += text.charCodeAt(pos) + ",";
  }
  return seen;
}''', 'codes("abc") + "|" + codes("")'),
'outcome-of-the-turn-before.ts': ('the outcome that is asked is that of the turn before', '''
function codes(text: string): string {
  let seen = "";
  let wasInside = true;
  for (let pos = 0; wasInside; pos++) {
    seen += text.charCodeAt(pos) + ",";
    wasInside = pos < text.length;
  }
  return seen;
}''', 'codes("abc") + "|" + codes("")'),

# ---- ways around the test
'another-way-in-beside-the-test.ts': ('`pos < text.length || force`', '''
function codes(text: string, force: boolean): string {
  let seen = "";
  for (let pos = 0; pos < 7; pos++) {
    if (pos < text.length || force) seen += text.charCodeAt(pos) + ",";
  }
  return seen;
}''', 'codes("abc", true) + "|" + codes("abc", false) + "|" + codes("", true)'),
'second-test-beside-the-first.ts': ('`pos < text.length && text.charCodeAt(pos) === 32`, and a read behind the loop', '''
function blanks(text: string): string {
  let pos = 0;
  while (pos < text.length && text.charCodeAt(pos) === 32) pos++;
  return pos + "," + text.charCodeAt(pos);
}''', 'blanks("  a") + "|" + blanks("   ") + "|" + blanks("")'),
'read-behind-where-the-ways-meet.ts': ('the read stands behind the `if`, not in it', '''
function codes(text: string): string {
  let seen = "";
  let inside = 0;
  for (let pos = 0; pos < 7; pos++) {
    if (pos < text.length) inside++;
    seen += text.charCodeAt(pos) + ",";
  }
  return inside + ":" + seen;
}''', 'codes("abc") + "|" + codes("")'),
'read-on-the-way-that-failed.ts': ('the read stands in the `else`', '''
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos < 7; pos++) {
    if (pos < text.length) seen += "inside,";
    else seen += text.charCodeAt(pos) + ",";
  }
  return seen;
}''', 'codes("abc") + "|" + codes("")'),
'handler-leads-around-the-test.ts': ('where the test fails something is thrown and caught, and the read follows', '''
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos < 7; pos++) {
    try {
      if (pos >= text.length) throw new Error("outside");
    } catch {
    }
    seen += text.charCodeAt(pos) + ",";
  }
  return seen;
}''', 'codes("abc") + "|" + codes("")'),
'case-falls-through-to-the-read.ts': ('a case that has tested falls through to one that the test alone does not lead to', '''
function codes(text: string, way: number): string {
  let seen = "";
  for (let pos = 0; pos < 7; pos++) {
    switch (way) {
      case 0:
        if (pos >= text.length) {
          seen += "outside,";
          break;
        }
      case 1:
        seen += text.charCodeAt(pos) + ",";
    }
  }
  return seen;
}''', 'codes("abc", 0) + "|" + codes("abc", 1) + "|" + codes("abc", 2)'),
'labeled-continue-skips-the-test.ts': ('`continue` of the loop around comes to the read of the next turn by the step alone', '''
function codes(text: string): string {
  let seen = "";
  let pos = 0;
  outer: for (let turn = 0; turn < 6; turn++) {
    seen += text.charCodeAt(pos) + ",";
    while (pos < text.length) {
      pos += 2;
      continue outer;
    }
  }
  return seen;
}''', 'codes("abc") + "|" + codes("")'),

# ---- what the text is
'string-object.js': ('the text is a String object', '''
function codes(text) {
  let seen = "";
  for (let pos = 0; pos < text.length; pos++) seen += text.charCodeAt(pos) + "," + text[pos] + ";";
  return seen;
}''', 'codes(new String("abc")) + "|" + codes("abc") + "|" + codes(Object("")) '),
'object-with-a-length-that-borrows-the-method.js': ('an object says 5 for its length, converts to a text of two, and has borrowed charCodeAt', '''
function codes(text) {
  let seen = "";
  for (let pos = 0; pos < text.length; pos++) seen += text.charCodeAt(pos) + ",";
  return seen;
}
const borrower = { length: 5, charCodeAt: String.prototype.charCodeAt, toString() { return "ab"; } };''', 'codes(borrower) + "|" + codes("ab")'),
'method-called-on-another-receiver.js': ('charCodeAt is read off the text that was tested and called on a shorter one', '''
function code(text, other, pos) {
  if (pos < text.length) return String(text.charCodeAt.call(other, pos));
  return "outside";
}''', 'code("abcdef", "ab", 4) + "|" + code("abcdef", "ab", 1)'),
'own-method-named-like-the-built-in.ts': ('the receiver is an object of the program with a length and a charCodeAt of its own', '''
class Tape {
  length = 3;
  charCodeAt(pos: number): number {
    return pos === 2 ? NaN : pos + 0.5;
  }
}
function codes(tape: Tape): string {
  let seen = "";
  for (let pos = 0; pos < tape.length; pos++) seen += tape.charCodeAt(pos) + ",";
  return seen;
}''', 'codes(new Tape())'),
'rope-made-flat-in-the-loop.ts': ('the text is a rope until the first read', '''
function codes(head: string, tail: string): string {
  const text = head + tail;
  let sum = 0;
  for (let pos = 0; pos < text.length; pos++) sum = (sum * 31 + text.charCodeAt(pos)) | 0;
  return text.length + "," + sum;
}''', 'codes("abcdefghijklmnopqrstuvwxyz".repeat(3), "0123456789".repeat(4)) + "|" + codes("", "") + "|" + codes("\\u4e2d".repeat(20), "abcdefghij".repeat(3))'),
'text-grows-in-the-loop.ts': ('each turn adds to the text, and the test asks the new length', '''
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos < text.length && pos < 8; pos++) {
    seen += text.charCodeAt(pos) + ",";
    if (pos % 2 === 0) text += "z";
  }
  return seen + text;
}''', 'codes("ab") + "|" + codes("")'),
'text-of-two-byte-units.ts': ('units above 255, and a text that is wide by one unit at its end', '''
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos < text.length; pos++) seen += text.charCodeAt(pos) + ",";
  return seen;
}''', 'codes("\\u4e2d\\u6587") + "|" + codes("ab\\u0100") + "|" + codes("\\u00ff\\u0100\\uffff") + "|" + codes("ab")'),
'code-points-of-pairs-at-the-end.ts': ('a pair, a lead surrogate as the last unit, a trail surrogate alone', '''
function points(text: string): string {
  let seen = "";
  for (let pos = 0; pos < text.length; pos++) seen += text.codePointAt(pos) + ",";
  return seen;
}''', 'points("a\\ud83d\\ude00") + "|" + points("a\\ud83d") + "|" + points("\\ude00a") + "|" + points("\\ud83d\\ud83d\\ude00") + "|" + points("")'),
'piece-of-a-text.ts': ('the text is a slice, and the position is below the length of the slice or of the whole', '''
function codes(whole: string, from: number, to: number): string {
  const piece = whole.slice(from, to);
  let seen = "";
  for (let pos = 0; pos < piece.length; pos++) seen += piece.charCodeAt(pos) + ",";
  for (let pos = 0; pos < whole.length; pos++) seen += piece.charCodeAt(pos) + ";";
  return seen;
}''', 'codes("abcdef", 2, 4) + "|" + codes("abcdef", 4, 2) + "|" + codes("abcdef", 5, 99)'),
'text-or-nothing.ts': ('the text may be undefined, and `?.` stands in the test alone', '''
function code(text: string | undefined, pos: number): string {
  try {
    if (pos < (text?.length ?? 9)) return String(text!.charCodeAt(pos));
    return "outside";
  } catch (error) {
    return (error as Error).name;
  }
}''', 'code("abc", 1) + "|" + code("abc", 4) + "|" + code(undefined, 4)'),

# ---- what is done with the character
'char-code-comes-round-the-loop.ts': ('the char code is carried from turn to turn', '''
function last(text: string): string {
  let code = -1;
  let sum = 0;
  for (let pos = 0; pos < text.length; pos++) {
    sum += code;
    code = text.charCodeAt(pos);
  }
  return code + "," + sum;
}''', 'last("abc") + "|" + last("") + "|" + last("\\uffff\\uffff")'),
'char-code-at-a-position-below-zero-comes-round.ts': ('the char code is carried from turn to turn, and the first positions lie below zero', '''
function last(text: string, from: number): string {
  let code = 7;
  let sum = 0;
  for (let pos = from; pos < text.length; pos++) {
    sum += code;
    code = text.charCodeAt(pos);
  }
  return code + "," + sum;
}''', 'last("abc", -2) + "|" + last("", -1) + "|" + last("abc", 0)'),
'not-a-number-comes-round-once.ts': ('of two reads that come round one lies behind the end in the last turn', '''
function last(text: string): string {
  let code = 0;
  let sum = 0;
  for (let pos = 0; pos < text.length; pos++) {
    code = pos % 2 ? text.charCodeAt(pos) : text.charCodeAt(pos + 1);
    sum += code;
  }
  return code + "," + sum;
}''', 'last("abc") + "|" + last("abcd") + "|" + last("a")'),
'code-point-comes-round-the-loop.ts': ('the code point is carried from turn to turn, and decides the step', '''
function points(text: string): string {
  let point = 0;
  let seen = "";
  for (let pos = 0; pos < text.length; pos += point > 0xffff ? 2 : 1) {
    point = text.codePointAt(pos)!;
    seen += point + ",";
  }
  return seen + point;
}''', 'points("a\\ud83d\\ude00b") + "|" + points("\\ud83d") + "|" + points("")'),
'line-starts.ts': ('a switch on the char code, and a second read behind the step that may lie at the end', '''
function lineStarts(text: string): string {
  const starts: number[] = [];
  let pos = 0;
  let lineStart = 0;
  while (pos < text.length) {
    const ch = text.charCodeAt(pos);
    pos++;
    switch (ch) {
      case 13:
        if (text.charCodeAt(pos) === 10) pos++;
      case 10:
        starts.push(lineStart);
        lineStart = pos;
        break;
      default:
        if (ch > 127 && (ch === 0x2028 || ch === 0x2029)) {
          starts.push(lineStart);
          lineStart = pos;
        }
        break;
    }
  }
  starts.push(lineStart);
  return starts.join();
}''', 'lineStarts("a\\r\\nb\\nc\\r") + "|" + lineStarts("\\r") + "|" + lineStarts("") + "|" + lineStarts("a\\u2028b\\u2029")'),
'characters-by-index-charat-and-at.ts': ('`text[pos]`, charAt and at, inside and one behind', '''
function letters(text: string): string {
  let seen = "";
  for (let pos = 0; pos < text.length; pos++) seen += text[pos] + text.charAt(pos) + text.at(pos) + "," + text[pos + 1] + text.charAt(pos + 1) + text.at(pos + 1) + ";";
  return seen;
}''', 'letters("abc") + "|" + letters("") + "|" + letters("\\u4e2da")'),
'at-counts-from-the-end.ts': ('at() of a position that is below the length and below zero', '''
function letters(text: string, from: number): string {
  let seen = "";
  for (let pos = from; pos < text.length; pos++) seen += text.at(pos) + ",";
  return seen;
}''', 'letters("abc", -5) + "|" + letters("abc", 0) + "|" + letters("", -1)'),
'suspended-between-the-test-and-the-read.ts': ('a generator yields between the test and the read, and whoever steps it moves nothing of its own', '''
function* codes(text: string): Generator<number, void, void> {
  for (let pos = 0; pos < text.length; pos++) {
    yield -1;
    yield text.charCodeAt(pos);
  }
}''', '[...codes("abc")].join() + "|" + [...codes("")].join()'),
}

folder = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'parallel', 'positions-in-texts')
os.makedirs(folder, exist_ok=True)
for name, (what, subject, answer) in cases.items():
    typed = ': string' if name.endswith('.ts') else ''
    text = f'// {what}\n{subject.strip()}\nfunction deed(){typed} {{\n  return {answer.strip()};\n}}\n{TAIL}'
    with open(os.path.join(folder, name), 'w') as file:
        file.write(text)
print(len(cases), 'programs in', os.path.normpath(folder))
