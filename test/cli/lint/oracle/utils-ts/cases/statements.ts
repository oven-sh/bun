// Where a statement starts, and what is before it.
a
b
;[c]
d; e
if (a) b
else c
do d
while (e) f
for (;;) g
for (a in b) h
for (a of b) i
label: j
x = function () {}
k
x = class {}
l
x = {}
m
x = () => {}
n
function fd() {}
o
class CD {}
p
x++
q
x = `t${1}`
r
import 's'
t
export * from 's'
u
export { v } from 's'
w
import z = require('s')
y
'use strict'
aa
function* gen() {
  yield
  ab
  return
  ac
}
loop: for (;;) {
  break
  ad
  continue loop
  ae
}
debugger
af
type T = { a: 1 }
ag
x = <T>a
ah
const arrow1 = () => ({}).a
const arrow2 = () => ({} as T)
const arrow3 = () => (<T>{})
const arrow4 = () => function () {}.name
const arrow5 = () => a, b
;({}).a
;(function () {}).name
;(class {}).name
a, b, c
;(a, b), c
if ((a, b)) c
if ((a, b, c) && !d ? e : f) g
while (a ?? b) c
for (; a || b; ) c
do c; while (!(a && b))
x = a ? b : c
switch (a) { case b: c; d }
with (a) b
