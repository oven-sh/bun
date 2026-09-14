int loop(int rounds, int n) {
             int checksum = 0;
             for (int i = 0; i < rounds; i++) {
                 char buffer[n];
                 buffer[0] = (char)i; buffer[n - 1] = 1;
                 if (i % 3 == 0) continue;
                 if (i == rounds - 1) break;
                 checksum += buffer[0] + buffer[n - 1];
             }
             return checksum;
         }
         int nested(int n) {
             int total = 0;
             for (int i = 0; i < 1000; i++) {
                 int outer[n];
                 outer[0] = i;
                 {
                     int inner[n * 2];
                     inner[1] = 2;
                     if (i & 1) goto next;
                     total += inner[1];
                 }
                 total += outer[0];
             next:;
             }
             return total;
         }
         int retry(int n) {
             int attempts = 0;
         again:;
             { long scratch[n]; scratch[n - 1] = attempts; attempts++; if (attempts < 500) goto again; return (int)scratch[n - 1]; }
         }
         int in_switch(int k, int n) {
             int r = 0;
             for (int i = 0; i < 300; i++) {
                 switch (k) { case 1: { int a[n]; a[0] = 5; r += a[0]; break; } default: { int b[n]; b[0] = 1; r += b[0]; } }
             }
             return r;
         }
         extern void *alloca(unsigned long);
         int alloca_inside(int n) {
             int s = 0;
             for (int i = 0; i < 2000; i++) { char tag[n]; char *p = alloca(256); p[0] = tag[0] = (char)i; s += p[0] == tag[0]; }
             return s;
         }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)loop(100000, 4096));
  printf("%d\n", (int)nested(64));
  printf("%d\n", (int)retry(32));
  printf("%d\n", (int)in_switch(1, 100));
  printf("%d\n", (int)in_switch(2, 100));
  printf("%d\n", (int)alloca_inside(128));
  return 0;
}
