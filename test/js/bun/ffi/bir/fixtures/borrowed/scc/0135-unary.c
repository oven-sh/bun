int
main()
{
        int x;

        x = 3;
        x = !x; //  0
        x = !x; //  1
        x = ~x; // -1
        x = -x; //  2
        if(x != 2)
                return 1;
        return 0;
}
