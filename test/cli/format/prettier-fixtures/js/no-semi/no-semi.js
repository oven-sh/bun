
// with preexisting semi

x; [1, 2, 3].forEach(fn)
x; [a, b, ...c] = [1, 2]
x; /r/i.test('r')
x; +1
x; - 1
x; ('h' + 'i').repeat(10)
x; (1, 2)
x; (() => {})()
x; ({ a: 1 }).entries()
x; ({ a: 1 }).entries()
x; <Hello />
x; `string`
x; (x, y) => x

// doesn't have to be preceded by a semicolon

class X {} [1, 2, 3].forEach(fn)


// don't semicolon if it doesn't start statement

if (true) (() => {})()


// check indentation

if (true) {
  x; (() => {})()
}

// check statement clauses

do break; while (false)
if (true) do break; while (false)

if (true) 1; else 2
for (;;) ;
for (x of y) ;

debugger

// check that it doesn't break non-ASI

1
- 1

1
+ 1

1
/ 1

arr
[0]

fn
(x)

!1

1
< 1

tag
`string`

x; x => x

x; (a || b).c++

x; ++(a || b).c

while (false)
  (function(){}())

aReallyLongLine012345678901234567890123456789012345678901234567890123456789 *
  (b + c)
