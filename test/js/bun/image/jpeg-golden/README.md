# JPEG files and pictures, and what libjpeg-turbo made of them

`cases.json.gz` holds JPEG files with what `Bun.Image` decoded them to when it used
libjpeg-turbo 3.2.0. `encoded.json.gz` holds what it encoded the pictures of
`encodeCases()` to. `observe.ts` says what is looked at, and `record.ts` how to add
a file, take one out and record again.

## What is not libjpeg-turbo's

`src/jpeg` refuses a scan of what an earlier scan has coded, which libjpeg-turbo
decodes. That changes what is expected of 8 files and of 12 of their damaged copies, all
from pixels to `ERR_IMAGE_DECODE_FAILED`:
`history/scanorder/so_16x48_2x2_rand8.jpg`, `history/scanorder/so_40x40_2x2_rand7.jpg`,
`history/1.2.0-6_k-id/c33x31_ycck422prog_k3.jpg`, `history/scan_params/prog_scan3_0_0_ed.jpg`,
`jpeg-image-002.jpg` and `jpeg-image-003.jpg` of `history/seed-corpora/mozilla_1050342`,
`history/seed-corpora/mozilla_891693_CVE-2013-6629_CVE-2013-6630/182.jpg` and
`lossless/ll_2x2_twice.jpg`. After recording with Bun 1.4.4, `record.ts --accept` with a
current build has to name these and no others.

## Where the files come from

- `c<width>x<height>_*`: crops of `testimages/testorig.ppm` of libjpeg-turbo, encoded
  in every way that `cjpeg`, `jpegtran` and TurboJPEG offer.
- `regress-*`: such files with damage that this codec and libjpeg-turbo once
  disagreed about.
- `history/`: made for bugs that libjpeg-turbo has fixed, and named after the CVE, the
  ChangeLog entry or the commit. They are crops as above with bytes changed, or
  written by a script from made-up numbers.
- `history/seed-corpora/`: the project's own files for such bugs, 32 of those in
  `bugs/decompress` of
  [libjpeg-turbo/seed-corpora](https://github.com/libjpeg-turbo/seed-corpora).
- `arith/`, `huffman/`, `idct/`, `lossless/`, `output/`: written by scripts from made-up
  numbers, for code that no encoder leads to: errors in arithmetic coding, bad Huffman
  tables, data that ends or has an FF where the decoder reads ahead, extreme
  coefficients, subsampled lossless streams, scans that are cut short. Some were then
  damaged at random and cut down to the bytes that matter. The two `arith/table_walk_*`
  lead through every state of the arithmetic decoder's table, and out of each both ways.
- `markers/`: one file for each of 22 checks on markers and on what they say of the
  image. Crops as above with bytes changed, or written by a script.
- `icc/`: `c5x7_s1x1_opt` with a made-up profile in three segments that are out of
  order.
- `wide/`: a made-up picture that is wide enough for the widest vectors, encoded by
  libjpeg-turbo as 4:2:2 and as YCCK.

## Licenses

`testorig.ppm` is the Independent JPEG Group's and comes under the IJG license, which
is in [`src/jpeg/README.ijg`](../../../../../src/jpeg/README.ijg).

`bugs/` in libjpeg-turbo/seed-corpora has no license. Its files were attached to
reports of bugs in libjpeg-turbo and Firefox. Nearly all of the 32 are noise or the
output of a fuzzer, and decode to nothing that can be recognised or not at all.

Everything else was made for this test.
