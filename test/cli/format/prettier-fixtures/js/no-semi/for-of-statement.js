for (a of b) foo

// 11
;[]

for (a of b) foo

// 21
;foo

// prettier-ignore
for (   a of   b)   foo (   )

;[]

for (a of b) foo /* comment */ ;

// prettier-ignore
for (   a of   b) while   (   1)   foo (   )

;[]
