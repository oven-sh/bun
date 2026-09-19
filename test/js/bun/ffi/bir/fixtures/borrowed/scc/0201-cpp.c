/* taken from ISO/IEC 9899:1999 Section 6.10.3.5 p7 */

#define t(x,y,z) x ## y ## z

int j[] = { t(1,2,3), t(,4,5), t(6,,7), t(8,9,),
     t(10,,), t(,11,), t(,,12), t(,,) };

int
main()
{
	if (j[0] != 123)
		return 1;
	if (j[1] != 45)
		return 2;
	if (j[2] != 67)
		return 3;
	if (j[3] != 89)
		return 4;
	if (j[4] != 10)
		return 5;
	if (j[5] != 11)
		return 6;
	if (j[6] != 12)
		return 7;
	return 0;
}
