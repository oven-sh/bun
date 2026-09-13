#include <stddef.h>
         struct natural { char c; int i; short s; long long l; };
         #pragma pack(push, 1)
         struct one { char c; int i; short s; long long l; };
         #pragma pack(2)
         struct two { char c; int i; short s; long long l; };
         #pragma pack(push, 4)
         struct four { char c; long long l; int bits : 3; };
         #pragma pack(pop)
         struct two_again { char c; int i; };
         #pragma pack(pop)
         struct back { char c; int i; };
         _Pragma("pack(1)") struct by_operator { char c; int i; }; _Pragma("pack()")
         struct reset { char c; int i; };
         #pragma pack(8)
         struct capped_not_raised { char c; short s; };
         #pragma pack()
         int sizes[] = { sizeof(struct natural), sizeof(struct one), sizeof(struct two), sizeof(struct four),
                         sizeof(struct two_again), sizeof(struct back), sizeof(struct by_operator), sizeof(struct reset),
                         sizeof(struct capped_not_raised) };
         int offsets[] = { offsetof(struct one, i), offsetof(struct one, l), offsetof(struct two, i), offsetof(struct two, l),
                           offsetof(struct four, l), _Alignof(struct one), _Alignof(struct two), _Alignof(struct four) };
         int size(int i) { return sizes[i]; }
         int offset(int i) { return offsets[i]; }
         struct one global_one = { 1, 0x01020304, 5, 6 };
         int unaligned_read(void) { struct one *p = &global_one; return p->i + (int)p->l; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)size(0));
  printf("%d\n", (int)size(1));
  printf("%d\n", (int)size(2));
  printf("%d\n", (int)size(3));
  printf("%d\n", (int)size(4));
  printf("%d\n", (int)size(5));
  printf("%d\n", (int)size(6));
  printf("%d\n", (int)size(7));
  printf("%d\n", (int)size(8));
  printf("%d\n", (int)offset(0));
  printf("%d\n", (int)offset(1));
  printf("%d\n", (int)offset(2));
  printf("%d\n", (int)offset(3));
  printf("%d\n", (int)offset(4));
  printf("%d\n", (int)offset(5));
  printf("%d\n", (int)offset(6));
  printf("%d\n", (int)offset(7));
  printf("%d\n", (int)unaligned_read());
  return 0;
}
