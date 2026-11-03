# Modules of the library that lean on math, _statistics, _stat and errno.
import statistics, fractions, stat, numbers, math

N = statistics.NormalDist
print(statistics.mean([1, 2, 3.5]), statistics.fmean([1.5, 2.5, 4]), statistics.fmean([1, 2, 3], weights=[3, 2, 1]), statistics.geometric_mean([1, 2, 4, 9.5]), statistics.harmonic_mean([1, 2, 4]))
print(statistics.median([3, 1, 2]), statistics.median([4, 1, 2, 3]), statistics.mode('aabbbc'), statistics.multimode('aabb'), statistics.quantiles(range(1, 100), n=4), statistics.quantiles([1.5, 2, 7, 9, 12], n=3, method='inclusive'))
print(statistics.variance([1, 2, 3.5, 7]), statistics.stdev([1, 2, 3.5, 7]), statistics.pvariance([1, 2, 3.5, 7]), statistics.pstdev([1, 2, 3.5, 7]), statistics.stdev([fractions.Fraction(1, 3), fractions.Fraction(2, 3), 1]))
print(statistics.correlation([1, 2, 3, 4], [1, 3, 2, 5]), statistics.covariance([1, 2, 3, 4], [1, 3, 2, 5]), statistics.linear_regression([1, 2, 3, 4], [1, 3, 2, 5]))
n = N(100, 15)
print(n, n.mean, n.stdev, n.variance, n.pdf(110), n.cdf(110), n.inv_cdf(0.9), n.inv_cdf(0.001), n.zscore(130), n.quantiles(4), n.overlap(N(110, 10)), n + 5, n * 2, N.from_samples([1, 2, 3, 4.5]))
for p in (0, 1, -1, 2):
    try:
        n.inv_cdf(p)
    except statistics.StatisticsError as e:
        print(p, 'StatisticsError:', e)
print(statistics.kde([1, 2, 3.5], h=1.0)(2.0), statistics.kde([1, 2, 3.5], h=1.0, kernel='triangular', cumulative=True)(2.0))

F = fractions.Fraction
print(F(6, 8), F(0.5), F('3/7'), F(1, 3) + F(1, 6), F(10**30, 4 * 10**29), math.floor(F(7, 2)), math.ceil(F(7, 2)), math.trunc(F(-7, 2)), round(F(7, 2)), F(7, 2).limit_denominator(1), F(math.pi).limit_denominator(1000), float(F(1, 3)), math.sqrt(F(1, 4)), math.isclose(F(1, 3), 0.3333333333))
print(isinstance(1.5, numbers.Real), isinstance(1, numbers.Integral), isinstance(1j, numbers.Complex), isinstance(F(1, 2), numbers.Rational))

print(stat.filemode(0o100644), stat.filemode(0o40755), stat.filemode(0o120777), stat.S_ISDIR(0o40755), stat.S_ISREG(0o40755), stat.S_IFMT(0o100644), stat.S_IMODE(0o100644), stat.S_IFDIR, stat.ST_MTIME, stat.UF_HIDDEN, stat.FILE_ATTRIBUTE_HIDDEN, stat.IO_REPARSE_TAG_SYMLINK)
print(stat.S_ISDIR.__module__, stat.filemode.__module__)
