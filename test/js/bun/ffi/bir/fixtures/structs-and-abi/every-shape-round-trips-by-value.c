int memcmp(const void *, const void *, unsigned long);
static void scribble(void *p, unsigned long n) { unsigned char *b = p; while (n--) *b++ ^= 0x5a; }
struct T0 { int a; };
static struct T0 id0(struct T0 x) { struct T0 copy = x; scribble(&x, sizeof x); return copy; }
static struct T0 (*const indirect0)(struct T0) = id0;
int check0(void) {
struct T0 original = { 7 }, before = original;
struct T0 back = id0(original);
struct T0 again = indirect0(id0(back));
return memcmp(&back, &before, sizeof back) == 0 && memcmp(&original, &before, sizeof before) == 0 && memcmp(&again, &before, sizeof again) == 0;
}
struct T1 { char a; };
static struct T1 id1(struct T1 x) { struct T1 copy = x; scribble(&x, sizeof x); return copy; }
static struct T1 (*const indirect1)(struct T1) = id1;
int check1(void) {
struct T1 original = { 'x' }, before = original;
struct T1 back = id1(original);
struct T1 again = indirect1(id1(back));
return memcmp(&back, &before, sizeof back) == 0 && memcmp(&original, &before, sizeof before) == 0 && memcmp(&again, &before, sizeof again) == 0;
}
struct T2 { short a; char b; };
static struct T2 id2(struct T2 x) { struct T2 copy = x; scribble(&x, sizeof x); return copy; }
static struct T2 (*const indirect2)(struct T2) = id2;
int check2(void) {
struct T2 original = { -3, 'y' }, before = original;
struct T2 back = id2(original);
struct T2 again = indirect2(id2(back));
return memcmp(&back, &before, sizeof back) == 0 && memcmp(&original, &before, sizeof before) == 0 && memcmp(&again, &before, sizeof again) == 0;
}
struct T3 { int a, b; };
static struct T3 id3(struct T3 x) { struct T3 copy = x; scribble(&x, sizeof x); return copy; }
static struct T3 (*const indirect3)(struct T3) = id3;
int check3(void) {
struct T3 original = { 1, -2 }, before = original;
struct T3 back = id3(original);
struct T3 again = indirect3(id3(back));
return memcmp(&back, &before, sizeof back) == 0 && memcmp(&original, &before, sizeof before) == 0 && memcmp(&again, &before, sizeof again) == 0;
}
struct T4 { long a, b; };
static struct T4 id4(struct T4 x) { struct T4 copy = x; scribble(&x, sizeof x); return copy; }
static struct T4 (*const indirect4)(struct T4) = id4;
int check4(void) {
struct T4 original = { 1L << 40, -5 }, before = original;
struct T4 back = id4(original);
struct T4 again = indirect4(id4(back));
return memcmp(&back, &before, sizeof back) == 0 && memcmp(&original, &before, sizeof before) == 0 && memcmp(&again, &before, sizeof again) == 0;
}
struct T5 { long a, b, c; };
static struct T5 id5(struct T5 x) { struct T5 copy = x; scribble(&x, sizeof x); return copy; }
static struct T5 (*const indirect5)(struct T5) = id5;
int check5(void) {
struct T5 original = { 11, 22, 33 }, before = original;
struct T5 back = id5(original);
struct T5 again = indirect5(id5(back));
return memcmp(&back, &before, sizeof back) == 0 && memcmp(&original, &before, sizeof before) == 0 && memcmp(&again, &before, sizeof again) == 0;
}
struct T6 { double a; };
static struct T6 id6(struct T6 x) { struct T6 copy = x; scribble(&x, sizeof x); return copy; }
static struct T6 (*const indirect6)(struct T6) = id6;
int check6(void) {
struct T6 original = { 2.5 }, before = original;
struct T6 back = id6(original);
struct T6 again = indirect6(id6(back));
return memcmp(&back, &before, sizeof back) == 0 && memcmp(&original, &before, sizeof before) == 0 && memcmp(&again, &before, sizeof again) == 0;
}
struct T7 { float a; };
static struct T7 id7(struct T7 x) { struct T7 copy = x; scribble(&x, sizeof x); return copy; }
static struct T7 (*const indirect7)(struct T7) = id7;
int check7(void) {
struct T7 original = { 1.5f }, before = original;
struct T7 back = id7(original);
struct T7 again = indirect7(id7(back));
return memcmp(&back, &before, sizeof back) == 0 && memcmp(&original, &before, sizeof before) == 0 && memcmp(&again, &before, sizeof again) == 0;
}
struct T8 { float a, b; };
static struct T8 id8(struct T8 x) { struct T8 copy = x; scribble(&x, sizeof x); return copy; }
static struct T8 (*const indirect8)(struct T8) = id8;
int check8(void) {
struct T8 original = { 1.5f, -2.25f }, before = original;
struct T8 back = id8(original);
struct T8 again = indirect8(id8(back));
return memcmp(&back, &before, sizeof back) == 0 && memcmp(&original, &before, sizeof before) == 0 && memcmp(&again, &before, sizeof again) == 0;
}
struct T9 { float a, b, c; };
static struct T9 id9(struct T9 x) { struct T9 copy = x; scribble(&x, sizeof x); return copy; }
static struct T9 (*const indirect9)(struct T9) = id9;
int check9(void) {
struct T9 original = { 1.5f, -2.25f, 8.0f }, before = original;
struct T9 back = id9(original);
struct T9 again = indirect9(id9(back));
return memcmp(&back, &before, sizeof back) == 0 && memcmp(&original, &before, sizeof before) == 0 && memcmp(&again, &before, sizeof again) == 0;
}
struct T10 { float a, b, c, d; };
static struct T10 id10(struct T10 x) { struct T10 copy = x; scribble(&x, sizeof x); return copy; }
static struct T10 (*const indirect10)(struct T10) = id10;
int check10(void) {
struct T10 original = { 1.5f, -2.25f, 8.0f, 0.125f }, before = original;
struct T10 back = id10(original);
struct T10 again = indirect10(id10(back));
return memcmp(&back, &before, sizeof back) == 0 && memcmp(&original, &before, sizeof before) == 0 && memcmp(&again, &before, sizeof again) == 0;
}
struct T11 { double a, b; };
static struct T11 id11(struct T11 x) { struct T11 copy = x; scribble(&x, sizeof x); return copy; }
static struct T11 (*const indirect11)(struct T11) = id11;
int check11(void) {
struct T11 original = { 1.5, -2.25 }, before = original;
struct T11 back = id11(original);
struct T11 again = indirect11(id11(back));
return memcmp(&back, &before, sizeof back) == 0 && memcmp(&original, &before, sizeof before) == 0 && memcmp(&again, &before, sizeof again) == 0;
}
struct T12 { double a, b, c; };
static struct T12 id12(struct T12 x) { struct T12 copy = x; scribble(&x, sizeof x); return copy; }
static struct T12 (*const indirect12)(struct T12) = id12;
int check12(void) {
struct T12 original = { 1.5, -2.25, 1e100 }, before = original;
struct T12 back = id12(original);
struct T12 again = indirect12(id12(back));
return memcmp(&back, &before, sizeof back) == 0 && memcmp(&original, &before, sizeof before) == 0 && memcmp(&again, &before, sizeof again) == 0;
}
struct T13 { int a; double b; };
static struct T13 id13(struct T13 x) { struct T13 copy = x; scribble(&x, sizeof x); return copy; }
static struct T13 (*const indirect13)(struct T13) = id13;
int check13(void) {
struct T13 original = { -9, 0.75 }, before = original;
struct T13 back = id13(original);
struct T13 again = indirect13(id13(back));
// (Member by member: what the padding between them holds after a copy is unspecified, 6.2.6.1p6.)
return back.a == before.a && back.b == before.b && original.a == before.a && original.b == before.b && again.a == before.a && again.b == before.b;
}
struct T14 { double a; int b; };
static struct T14 id14(struct T14 x) { struct T14 copy = x; scribble(&x, sizeof x); return copy; }
static struct T14 (*const indirect14)(struct T14) = id14;
int check14(void) {
struct T14 original = { 0.75, -9 }, before = original;
struct T14 back = id14(original);
struct T14 again = indirect14(id14(back));
// (Member by member: what the padding between them holds after a copy is unspecified, 6.2.6.1p6.)
return back.a == before.a && back.b == before.b && original.a == before.a && original.b == before.b && again.a == before.a && again.b == before.b;
}
struct T15 { float a; int b; };
static struct T15 id15(struct T15 x) { struct T15 copy = x; scribble(&x, sizeof x); return copy; }
static struct T15 (*const indirect15)(struct T15) = id15;
int check15(void) {
struct T15 original = { 0.5f, 123456 }, before = original;
struct T15 back = id15(original);
struct T15 again = indirect15(id15(back));
return memcmp(&back, &before, sizeof back) == 0 && memcmp(&original, &before, sizeof before) == 0 && memcmp(&again, &before, sizeof again) == 0;
}
struct T16 { char a[3]; };
static struct T16 id16(struct T16 x) { struct T16 copy = x; scribble(&x, sizeof x); return copy; }
static struct T16 (*const indirect16)(struct T16) = id16;
int check16(void) {
struct T16 original = { { 1, 2, 3 } }, before = original;
struct T16 back = id16(original);
struct T16 again = indirect16(id16(back));
return memcmp(&back, &before, sizeof back) == 0 && memcmp(&original, &before, sizeof before) == 0 && memcmp(&again, &before, sizeof again) == 0;
}
struct T17 { char a[5]; };
static struct T17 id17(struct T17 x) { struct T17 copy = x; scribble(&x, sizeof x); return copy; }
static struct T17 (*const indirect17)(struct T17) = id17;
int check17(void) {
struct T17 original = { { 1, 2, 3, 4, 5 } }, before = original;
struct T17 back = id17(original);
struct T17 again = indirect17(id17(back));
return memcmp(&back, &before, sizeof back) == 0 && memcmp(&original, &before, sizeof before) == 0 && memcmp(&again, &before, sizeof again) == 0;
}
struct T18 { char a[7]; };
static struct T18 id18(struct T18 x) { struct T18 copy = x; scribble(&x, sizeof x); return copy; }
static struct T18 (*const indirect18)(struct T18) = id18;
int check18(void) {
struct T18 original = { "sixsix" }, before = original;
struct T18 back = id18(original);
struct T18 again = indirect18(id18(back));
return memcmp(&back, &before, sizeof back) == 0 && memcmp(&original, &before, sizeof before) == 0 && memcmp(&again, &before, sizeof again) == 0;
}
struct T19 { char a[16]; };
static struct T19 id19(struct T19 x) { struct T19 copy = x; scribble(&x, sizeof x); return copy; }
static struct T19 (*const indirect19)(struct T19) = id19;
int check19(void) {
struct T19 original = { "fifteen chars.." }, before = original;
struct T19 back = id19(original);
struct T19 again = indirect19(id19(back));
return memcmp(&back, &before, sizeof back) == 0 && memcmp(&original, &before, sizeof before) == 0 && memcmp(&again, &before, sizeof again) == 0;
}
struct T20 { char a[17]; };
static struct T20 id20(struct T20 x) { struct T20 copy = x; scribble(&x, sizeof x); return copy; }
static struct T20 (*const indirect20)(struct T20) = id20;
int check20(void) {
struct T20 original = { "sixteen chars..." }, before = original;
struct T20 back = id20(original);
struct T20 again = indirect20(id20(back));
return memcmp(&back, &before, sizeof back) == 0 && memcmp(&original, &before, sizeof before) == 0 && memcmp(&again, &before, sizeof again) == 0;
}
struct T21 { int a, b, c; };
static struct T21 id21(struct T21 x) { struct T21 copy = x; scribble(&x, sizeof x); return copy; }
static struct T21 (*const indirect21)(struct T21) = id21;
int check21(void) {
struct T21 original = { 1, 2, 3 }, before = original;
struct T21 back = id21(original);
struct T21 again = indirect21(id21(back));
return memcmp(&back, &before, sizeof back) == 0 && memcmp(&original, &before, sizeof before) == 0 && memcmp(&again, &before, sizeof again) == 0;
}
struct T22 { struct { int x, y; } in; double d; };
static struct T22 id22(struct T22 x) { struct T22 copy = x; scribble(&x, sizeof x); return copy; }
static struct T22 (*const indirect22)(struct T22) = id22;
int check22(void) {
struct T22 original = { { 4, 5 }, 6.5 }, before = original;
struct T22 back = id22(original);
struct T22 again = indirect22(id22(back));
return memcmp(&back, &before, sizeof back) == 0 && memcmp(&original, &before, sizeof before) == 0 && memcmp(&again, &before, sizeof again) == 0;
}
struct T23 { double a[2]; };
static struct T23 id23(struct T23 x) { struct T23 copy = x; scribble(&x, sizeof x); return copy; }
static struct T23 (*const indirect23)(struct T23) = id23;
int check23(void) {
struct T23 original = { { 3.5, 4.5 } }, before = original;
struct T23 back = id23(original);
struct T23 again = indirect23(id23(back));
return memcmp(&back, &before, sizeof back) == 0 && memcmp(&original, &before, sizeof before) == 0 && memcmp(&again, &before, sizeof again) == 0;
}
struct T24 { unsigned a : 3; unsigned b : 20; short c; };
static struct T24 id24(struct T24 x) { struct T24 copy = x; scribble(&x, sizeof x); return copy; }
static struct T24 (*const indirect24)(struct T24) = id24;
int check24(void) {
struct T24 original = { 5, 99999, -7 }, before = original;
struct T24 back = id24(original);
struct T24 again = indirect24(id24(back));
return memcmp(&back, &before, sizeof back) == 0 && memcmp(&original, &before, sizeof before) == 0 && memcmp(&again, &before, sizeof again) == 0;
}
struct T25 { char bytes[64]; };
static struct T25 id25(struct T25 x) { struct T25 copy = x; scribble(&x, sizeof x); return copy; }
static struct T25 (*const indirect25)(struct T25) = id25;
int check25(void) {
struct T25 original = { "sixty-four bytes of struct passed through memory, by value...." }, before = original;
struct T25 back = id25(original);
struct T25 again = indirect25(id25(back));
return memcmp(&back, &before, sizeof back) == 0 && memcmp(&original, &before, sizeof before) == 0 && memcmp(&again, &before, sizeof again) == 0;
}

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)check0());
  printf("%d\n", (int)check1());
  printf("%d\n", (int)check2());
  printf("%d\n", (int)check3());
  printf("%d\n", (int)check4());
  printf("%d\n", (int)check5());
  printf("%d\n", (int)check6());
  printf("%d\n", (int)check7());
  printf("%d\n", (int)check8());
  printf("%d\n", (int)check9());
  printf("%d\n", (int)check10());
  printf("%d\n", (int)check11());
  printf("%d\n", (int)check12());
  printf("%d\n", (int)check13());
  printf("%d\n", (int)check14());
  printf("%d\n", (int)check15());
  printf("%d\n", (int)check16());
  printf("%d\n", (int)check17());
  printf("%d\n", (int)check18());
  printf("%d\n", (int)check19());
  printf("%d\n", (int)check20());
  printf("%d\n", (int)check21());
  printf("%d\n", (int)check22());
  printf("%d\n", (int)check23());
  printf("%d\n", (int)check24());
  printf("%d\n", (int)check25());
  return 0;
}
