#!/usr/bin/env python3
# generate-a-number-beside-what-may-be-a-big-integer.py <folder>: all 174; ../parallel/a-number-beside-what-may-be-a-big-integer/ holds 3 of them: one shape a program.
# THE PROOF: beside an operand that is a number (or undefined, null, a boolean), an operand that is proven a number or a big integer is a number wherever the operator answers: for a big integer it throws.
# ONE SHAPE A PROGRAM, each built alone: an operator x which side the number stands on x what makes the other operand x where the operation stands (a sum that goes round a loop, straight code, a condition).
# Each is run with numbers, with big integers (TypeError, at the same turn as under plain Bun: the count says so), with texts and with objects whose valueOf() gives either.
# where-both-sides-may-be-either: no side is proven a number: two big integers give a big integer.
# beside-what-may-be-a-text-too: the other operand may be a text as well: there nothing is proven, and a rule that says so all the same answers wrongly (the red control).
import os, sys
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
OPERATORS = {'plus': '+', 'minus': '-', 'times': '*', 'divided-by': '/', 'remainder': '%', 'to-the-power': '**', 'and': '&', 'or': '|', 'xor': '^', 'shifted-left': '<<', 'shifted-right': '>>', 'shifted-right-unsigned': '>>>', 'less-than': '<', 'at-most': '<='}
MAKERS = {'a-product': 'a * b', 'a-difference': 'a - b', 'a-negation': '-a', 'a-complement': '~a', 'a-quotient': 'a / b', 'a-power': 'a ** b', 'a-step': 'a++', 'a-conjunction': 'a & b'}
NUMBERS = {'a-sum-from-zero': None, 'a-constant': '7', 'a-fraction': '0.5', 'undefined': 'undefined', 'null': 'null', 'true': 'true', 'a-length': 'text.length'}
CALLS = '''const inputs: [unknown, unknown][] = [[2, 3], [2n, 3n], ["4", "2"], [{ valueOf() { calls++; return 5; } }, 2], [{ valueOf() { calls++; return 5n; } }, 2n], [2.5, -1], [-0, 3], [2 ** 31, 2], [2n ** 70n, 1n], [null, 1], [true, 2], [undefined, 2], [2, 3n], ["x", 1]];
for (const [a, b] of inputs) { let said: string; turns = 0; try { const answer = run(a, b); said = typeof answer + " " + String(Object.is(answer, -0) ? "-0" : answer); } catch (error) { said = (error as Error).name; } console.log(said, turns, calls); }'''


def write(name, what, body):
    open(os.path.join(OUT, name + '.ts'), 'w').write('\n'.join([f'// {what}', 'let turns = 0;', 'let calls = 0;', 'const text = "four";', f'function run(a: any, b: any) {{ {body} }}', CALLS]) + '\n')


for word, operator in OPERATORS.items():
    for maker, made in (('a-product', 'a * b'), ('a-negation', '-a')):
        for side in ('left', 'right'):
            both = lambda number: f'{number} {operator} ({made})' if side == 'left' else f'({made}) {operator} {number}'
            if operator not in ('<', '<='):
                write(f'{word}-the-number-on-the-{side}-of-{maker}-round-a-loop', f'a number that goes round a loop {word.replace("-", " ")} {maker.replace("-", " ")} of what nobody knows, the number on the {side}',
                      f'let total = 1; for (let i = 0; i < 3; i++) {{ turns++; total = {both("total")}; }} return total;')
            write(f'{word}-the-number-on-the-{side}-of-{maker}', f'a number {word.replace("-", " ")} {maker.replace("-", " ")} of what nobody knows, the number on the {side}',
                  f'turns++; const answer = {both("text.length")}; turns++; return answer;')
for maker, made in MAKERS.items():
    for number, written in NUMBERS.items():
        if written is None:
            write(f'{maker}-added-to-{number}', f'{maker.replace("-", " ")} of what nobody knows is added to a sum that goes round a loop', f'let total = 0; for (let i = 0; i < 3; i++) {{ turns++; total += {made}; }} return total;')
        else:
            write(f'{maker}-added-to-{number}', f'{maker.replace("-", " ")} of what nobody knows is added to {number.replace("-", " ")}', f'turns++; const answer = {written} + ({made}); turns++; return answer;')
for word, operator in (('plus', '+'), ('minus', '-'), ('times', '*')):
    for side in ('left', 'right'):
        other = '(turns & 1 ? a * b : String(a))'
        both = f'total {operator} {other}' if side == 'left' else f'{other} {operator} total'
        write(f'{word}-the-number-on-the-{side}-beside-what-may-be-a-text-too', f'a number {word} what is a number, a big integer or a text, the number on the {side}: nothing is proven',
              f'let total: any = 1; for (let i = 0; i < 2; i++) {{ turns++; const number = text.length + i; total = {both.replace("total", "number")}; }} return total;')
for word, operator in (('plus', '+'), ('minus', '-'), ('times', '*'), ('and', '&')):
    write(f'{word}-where-both-sides-may-be-either', f'what is a number or a big integer {word} what is a number or a big integer: nothing is proven, and two big integers give one',
          f'turns++; const answer = (a * b) {operator} (a - b); turns++; return answer;')
    write(f'{word}-where-both-sides-may-be-either-round-a-loop', f'what is a number or a big integer goes round a loop {word} what is a number or a big integer',
          f'let total = a * b; for (let i = 0; i < 3; i++) {{ turns++; total = total {operator} (a - b); }} return total;')
print(len(os.listdir(OUT)), 'programs')
