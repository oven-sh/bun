a ||= b;

a &&= "foo";
b ||= "foo";
c ??= "foo";

d &&= 42;
e ||= 42;
f ??= 42;

a.baz &&= result.baz;
b.baz ||= result.baz;
c.baz ??= result.baz;

a.foo["baz"] &&= result.foo.baz;
b.foo["baz"] ||= result.foo.baz;
c.foo["baz"] ??= result.foo.baz;

a.foo.bar().baz &&= result.foo.bar().baz;
b.foo.bar().baz ||= result.foo.bar().baz;
b.baz ||= result.baz;
c.baz ??= result.baz;

(results ||= []).push(100);
(results &&= []).push(100);
(results ??= []).push(100);

if ((thing &&= thing.original)) {
}
if ((thing &&= defaultValue)) {
}
if ((thing ||= defaultValue)) {
}
if ((thing ??= defaultValue)) {
}

f ||= (a) => a;
f &&= (a) => a;
f ??= (a) => a;

f ||= (f.toString(), (a) => a);
f &&= (f.toString(), (a) => a);
f ??= (f.toString(), (a) => a);

(results ||= results1 ||= []).push(100);
(results &&= results1 &&= []).push(100);
(results ??= results1 ??= []).push(100);

obj[incr()] ||= incr();
oobj["obj"][incr()] ||= incr();
obj[incr()] &&= incr();
oobj["obj"][incr()] &&= incr();
obj[incr()] ??= incr();
oobj["obj"][incr()] ??= incr();
