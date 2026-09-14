int overridden_function(void) { return 2; }
int overridden_object = 20;
__attribute__((weak)) int weak_in_both(void) { return 6; }
__attribute__((weak)) int weak_object_in_both = 60;
int by_pragma(void) { return 8; }
int declared_weak_first(void) { return 11; }
int tentative = 70;

int kept_function(void);
extern int kept_object;
int other_unit_sees(void) { return overridden_function() * 1000 + overridden_object * 10 + kept_function() + kept_object * 100; }
int strong_calls_weak(void) { return weak_in_both() + weak_object_in_both; }
