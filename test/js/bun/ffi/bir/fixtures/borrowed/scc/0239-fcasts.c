float f1 = 1.0;
float f2 = 1.0l;
double d1 = 1.0f;
double d2 = 1.0l;

int
main(void)
{
	double epsilon = 0.001;

	if (f1 < 1.0f - epsilon || f1 > 1.0f + epsilon)
		return 1;
	if (f2 < 1.0f - epsilon || f2 > 1.0f + epsilon)
		return 2;
	if (d1 < 1.0f - epsilon || d1 > 1.0f + epsilon)
		return 3;
	if (d2 < 1.0f - epsilon || d2 > 1.0f + epsilon)
		return 4;
	return 0;
}
