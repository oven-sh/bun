for ((x in a);;) {}
for (a=(a in b);;) {}
for (let a = (b in c); ; );
for (a && (b in c); ; );
for (a => (b in c); ; );
function* g() {
  for (yield (a in b); ; );
}
async function f() {
  for (await (a in b); ; );
}
for (a in b) 0;
