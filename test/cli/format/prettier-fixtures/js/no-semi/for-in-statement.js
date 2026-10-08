for (a in b) foo

// 11
;[]

for (a in b) foo

// 21
;foo

// prettier-ignore
for (   a in   b)   foo (   )

;[]

for (a in b) foo /* comment */ ;
