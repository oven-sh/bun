for ((let) of foo);
for (foo of let);
for (foo of let.a);
for (foo of let[a]);
for ((let.a) of foo);
for ((let[a]) of foo);
for ((let)().a of foo);
for (letFoo of foo);

for ((let.a) in foo);
for ((let[a]) in foo);

for (let of of let);
