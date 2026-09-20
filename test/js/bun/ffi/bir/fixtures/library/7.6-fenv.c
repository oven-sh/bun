// C11 7.6 <fenv.h>: the rounding direction and the exception flags are honoured by compiled arithmetic (on objects
// the compiler cannot see through).
#include <fenv.h>
#include <stdio.h>

#pragma STDC FENV_ACCESS ON

int main(void) {
  volatile double one = 1.0, three = 3.0, zero = 0.0, huge = 1e308, tiny = 1e-308;
  printf("%d\n", fegetround() == FE_TONEAREST);
  fesetround(FE_UPWARD);
  double up = one / three;
  fesetround(FE_DOWNWARD);
  double down = one / three;
  fesetround(FE_TOWARDZERO);
  double toward_zero = -one / three;
  fesetround(FE_TONEAREST);
  double nearest = one / three;
  printf("%d %d %d %d\n", up > down, nearest == up || nearest == down, toward_zero == -down, fegetround() == FE_TONEAREST);
  // The flags: raised by arithmetic, tested, cleared, saved and restored.
  feclearexcept(FE_ALL_EXCEPT);
  printf("%d\n", fetestexcept(FE_ALL_EXCEPT) == 0);
  volatile double r = one / zero;
  printf("%d %d\n", fetestexcept(FE_DIVBYZERO) != 0, r > huge);
  r = huge * huge;
  printf("%d\n", fetestexcept(FE_OVERFLOW) != 0);
  r = zero / zero;
  printf("%d %d\n", fetestexcept(FE_INVALID) != 0, r != r);
  r = one / three;
  printf("%d\n", fetestexcept(FE_INEXACT) != 0);
  r = tiny * tiny;
  printf("%d\n", fetestexcept(FE_UNDERFLOW) != 0);
  fexcept_t saved;
  fegetexceptflag(&saved, FE_ALL_EXCEPT);
  feclearexcept(FE_ALL_EXCEPT);
  printf("%d\n", fetestexcept(FE_DIVBYZERO | FE_INVALID) == 0);
  fesetexceptflag(&saved, FE_DIVBYZERO);
  printf("%d %d\n", fetestexcept(FE_DIVBYZERO) != 0, fetestexcept(FE_INVALID) == 0);
  // A whole environment: saved, changed, put back.
  fenv_t environment;
  fegetenv(&environment);
  fesetround(FE_UPWARD);
  feraiseexcept(FE_INVALID);
  fesetenv(&environment);
  printf("%d %d\n", fegetround() == FE_TONEAREST, fetestexcept(FE_INVALID) == 0);
  feclearexcept(FE_ALL_EXCEPT);
  return 0;
}
