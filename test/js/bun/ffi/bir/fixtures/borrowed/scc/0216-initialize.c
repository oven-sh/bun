#include <stdio.h>

char *plumbercmd = "mspaint.exe";

int
main(void)
{
        char *cmd[] = { plumbercmd, NULL, NULL };
        cmd[1] = "bla";

        return 0;
}
