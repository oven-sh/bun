for(;;) continue
// comment
;

for (;;) break
// comment
;

for (const f of []) continue
// comment3
;

for (const f of []) break
// comment4
;

for (const f in {}) continue
// comment5
;

for (const f in {}) break
// comment6
;

for(;;) continue // comment
;

for (;;) break // comment
;

for (const f of []) continue // comment
;

for (const f of []) break // comment
;

for (const f in {}) continue // comment
;

for (const f in {}) break // comment
;

for(;;) continue /* comment */
;

for (;;) break /* comment */
;

for (const f of []) continue /* comment */
;

for (const f of []) break /* comment */
;

for (const f in {}) continue /* comment */
;

for (const f in {}) break /* comment */
;

for(;;) continue
/* comment */
;

for (;;) break
/* comment */
;

for (const f of []) continue
/* comment 33 */
;

for (const f of []) break
/* comment 34 */
;

for (const f in {}) continue
/* comment 35 */
;

for (const f in {}) break
/* comment 36 */
;

label1: for (;;) continue label1 /* comment */
;

label1: for (;;) continue label1
/* comment */
;

label1: for (;;) continue label1 // comment
;

label1: for (;;) continue label1
// comment
;
