static int grid[3][4];
         int fill_and_sum(void) {
             for (int i = 0; i < 3; i++) for (int j = 0; j < 4; j++) grid[i][j] = i * 10 + j;
             int (*row)[4] = grid + 1;
             int *flat = &grid[0][0];
             return grid[2][3] + (*row)[2] + row[1][1] + flat[7] + (int)(sizeof grid / sizeof grid[0]) + (int)sizeof(grid[0]);
         }
         int local3d(void) {
             int cube[2][3][2] = { { {1, 2}, {3, 4}, {5, 6} }, { {7, 8}, {9, 10}, {11, 12} } };
             int s = 0;
             for (int i = 0; i < 2; i++) for (int j = 0; j < 3; j++) for (int k = 0; k < 2; k++) s = s * 2 + cube[i][j][k] % 2;
             return cube[1][2][0] * 10000 + s;
         }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)fill_and_sum());
  printf("%d\n", (int)local3d());
  return 0;
}
