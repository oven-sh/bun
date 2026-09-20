// C calling back into JavaScript through a function pointer that bun:ffi's JSCallback made.
int apply(int (*callback)(int), int value) { return callback(value) + callback(value + 1); }
double fold(double (*callback)(double, double), const double *values, int count) {
  double total = values[0];
  for (int i = 1; i < count; i++) total = callback(total, values[i]);
  return total;
}
static int (*kept)(int);
void keep(int (*callback)(int)) { kept = callback; }
int call_kept(int value) { return kept ? kept(value) : -1; }
