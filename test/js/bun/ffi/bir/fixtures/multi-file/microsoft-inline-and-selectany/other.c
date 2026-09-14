#include "shared.h"
int from_other(void) { return *counter() * 10 + twice(one_value); }
const char *name_in_other(void) { return one_name; }
int *value_in_other(void) { return &one_value; }
