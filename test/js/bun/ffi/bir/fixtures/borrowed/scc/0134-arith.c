int
main()
{
        int x;

        x = 0;
        if ((x = x + 2) != 2)        // 2
		return 1;
        if ((x = x - 1) != 1)        // 1
		return 2;
        if ((x = x * 6) != 6)        // 6
		return 3;
        if ((x = x / 2) != 3)        // 3
		return 4;
        if ((x = x % 2) != 1)        // 1
		return 5;
        if ((x = x << 2) != 4)       // 4
		return 6;
        if ((x = x >> 1) != 2)       // 2
		return 7;
        if ((x = x | 255) != 255)    // 255
		return 8;
        if ((x = x & 3) != 3)        // 3
		return 9;
        if ((x = x ^ 1) != 2)        // 2
		return 10;
        if ((x = x + (x > 1)) != 3)  // 3
		return 11;
        if ((x = x + (x < 3)) != 3)  // 3
		return 12;
        if ((x = x + (x > 1)) != 4)  // 4
		return 13;
        if ((x = x + (x < 4)) != 4)  // 4
		return 14;
        return 0;
}
