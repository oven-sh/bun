#include <unistd.h>

char one_mb_pipe_buf_1[1024 * 1024];

 int main(int argc, char* argv[])
 {
    for (int i = 0; i < sizeof(one_mb_pipe_buf_1); i++) {
      one_mb_pipe_buf_1[i] = i % 256;
    }

    while (1) {

    
    size_t amt = 0;
    size_t cnt = 0;

    cnt = 0;
    while (cnt < sizeof(one_mb_pipe_buf_1)) {
      amt = read(0, one_mb_pipe_buf_1 + cnt, sizeof(one_mb_pipe_buf_1) - cnt);
      if (amt == 0) {
        break;
      }
      cnt += amt;
    }
    }
 }