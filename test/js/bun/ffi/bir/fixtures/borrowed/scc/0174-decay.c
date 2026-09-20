int
main(int argc, char *argv[])
{
        int v[1];
        int (*p)[];
        int (*f1)(int ,char *[]);
        int (*f2)(int ,char *[]);

        v[0] = 0;
        p = &v;
        f1 = &main;
        f2 = main;
        if (argc == 0)
                return 0;
        if ((****main)(0, 0))
                return 2;
        if ((****f1)(0, 0))
                return 3;
        if ((****f2)(0, 0))
                return 4;
        if (!(*p)[0])
                return 0;
        return 1;
}
