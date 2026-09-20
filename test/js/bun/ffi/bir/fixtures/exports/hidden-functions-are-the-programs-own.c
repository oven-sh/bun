// `visibility("hidden")` (and "internal") says a function is for the program's other files and not for whoever loads
// the program: JavaScript does not see it among the exports. The program's own calls, from this file or another, do.
__attribute__((visibility("hidden"))) int hidden(int x) { return x + 1; }
__attribute__((visibility("internal"))) int internal(int x) { return x + 2; }
__attribute__((visibility("default"))) int by_default(int x) { return x + 3; }
__attribute__((visibility("protected"))) int protected_one(int x) { return x + 4; }
int hidden_by_a_declaration(int x);
__attribute__((visibility("hidden"))) int hidden_by_a_declaration(int x);
int hidden_by_a_declaration(int x) { return x + 5; }
int __attribute__((visibility("hid" "den"))) hidden_with_the_name_in_two_pieces(int x) { return x + 6; }
int uses_them(int x) { return hidden(x) + internal(x) + hidden_by_a_declaration(x) + hidden_with_the_name_in_two_pieces(x); }
