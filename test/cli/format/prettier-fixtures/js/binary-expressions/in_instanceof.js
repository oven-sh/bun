!foo in bar;
(!foo in bar); 
!(foo in bar);
(!foo) in bar;

!foo instanceof Bar;
(!foo instanceof Bar);
!(foo instanceof Bar);
(!foo) instanceof Bar;

~foo in bar;
(~foo in bar); 
~(foo in bar);
(~foo) in bar;

~foo instanceof Bar;
(~foo instanceof Bar);
~(foo instanceof Bar);
(~foo) instanceof Bar;

+foo in bar;
(+foo in bar); 
+(foo in bar);
(+foo) in bar;

+foo instanceof Bar;
(+foo instanceof Bar);
+(foo instanceof Bar);
(+foo) instanceof Bar;

-foo in bar;
(-foo in bar); 
-(foo in bar);
(-foo) in bar;

-foo instanceof Bar;
(-foo instanceof Bar);
-(foo instanceof Bar);
(-foo) instanceof Bar;

void 0 in bar;
(void 0 in bar);
void (0 in bar);
(void 0) in bar;

void 0 instanceof bar;
(void 0 instanceof bar);
void (0 instanceof bar);
(void 0) instanceof bar;

delete 0 in bar;
(delete 0 in bar);
delete (0 in bar);
(delete 0) in bar;

delete 0 instanceof bar;
(delete 0 instanceof bar);
delete (0 instanceof bar);
(delete 0) instanceof bar;

typeof 0 in bar;
(typeof 0 in bar);
typeof (0 in bar);
(typeof 0) in bar;

typeof 0 instanceof bar;
(typeof 0 instanceof bar);
typeof (0 instanceof bar);
(typeof 0) instanceof bar;

++x instanceof bar; // not ambiguous, because ++(x instanceof bar) is obviously invalid

!!foo instanceof Bar;
