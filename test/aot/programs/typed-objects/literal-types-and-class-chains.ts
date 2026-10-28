// Types of string and number literals, and chains of classes, are described to the run time in a compact form. An object passes an annotation or a cast whatever its fields hold, and untyped code
// stores what it likes. A field whose written type is a union of string literals is read as it is when it holds another string (`{"kind":"line"}`). What a class inherits is as in plain Bun.
// A string literal that nothing but types mentions is kept as a hash of 24 bytes, so that its text stays out of the executable: nearly all of the 961 here.
// DATA< 95000
const hide = (v: unknown): any => v
function attempt(label: string, f: () => unknown) { try { console.log(label, JSON.stringify(f())) } catch (e) { console.log(label, e instanceof TypeError ? "TypeError" : "other") } }
interface T0 { kind: "k0_0" | "k0_1" | "k0_2" | "k0_3" | "k0_4" | "k0_5" | "k0_6" | "k0_7"; code: 1 | 2 | -3 | 0.5; n0: number }
interface T1 { kind: "k1_0" | "k1_1" | "k1_2" | "k1_3" | "k1_4" | "k1_5" | "k1_6" | "k1_7"; code: 11 | 12 | -13 | 1.5; n1: number }
interface T2 { kind: "k2_0" | "k2_1" | "k2_2" | "k2_3" | "k2_4" | "k2_5" | "k2_6" | "k2_7"; code: 21 | 22 | -23 | 2.5; n2: number }
interface T3 { kind: "k3_0" | "k3_1" | "k3_2" | "k3_3" | "k3_4" | "k3_5" | "k3_6" | "k3_7"; code: 31 | 32 | -33 | 3.5; n3: number }
interface T4 { kind: "k4_0" | "k4_1" | "k4_2" | "k4_3" | "k4_4" | "k4_5" | "k4_6" | "k4_7"; code: 41 | 42 | -43 | 4.5; n4: number }
interface T5 { kind: "k5_0" | "k5_1" | "k5_2" | "k5_3" | "k5_4" | "k5_5" | "k5_6" | "k5_7"; code: 51 | 52 | -53 | 5.5; n5: number }
interface T6 { kind: "k6_0" | "k6_1" | "k6_2" | "k6_3" | "k6_4" | "k6_5" | "k6_6" | "k6_7"; code: 61 | 62 | -63 | 6.5; n6: number }
interface T7 { kind: "k7_0" | "k7_1" | "k7_2" | "k7_3" | "k7_4" | "k7_5" | "k7_6" | "k7_7"; code: 71 | 72 | -73 | 7.5; n7: number }
interface T8 { kind: "k8_0" | "k8_1" | "k8_2" | "k8_3" | "k8_4" | "k8_5" | "k8_6" | "k8_7"; code: 81 | 82 | -83 | 8.5; n8: number }
interface T9 { kind: "k9_0" | "k9_1" | "k9_2" | "k9_3" | "k9_4" | "k9_5" | "k9_6" | "k9_7"; code: 91 | 92 | -93 | 9.5; n9: number }
interface T10 { kind: "k10_0" | "k10_1" | "k10_2" | "k10_3" | "k10_4" | "k10_5" | "k10_6" | "k10_7"; code: 101 | 102 | -103 | 10.5; n10: number }
interface T11 { kind: "k11_0" | "k11_1" | "k11_2" | "k11_3" | "k11_4" | "k11_5" | "k11_6" | "k11_7"; code: 111 | 112 | -113 | 11.5; n11: number }
interface T12 { kind: "k12_0" | "k12_1" | "k12_2" | "k12_3" | "k12_4" | "k12_5" | "k12_6" | "k12_7"; code: 121 | 122 | -123 | 12.5; n12: number }
interface T13 { kind: "k13_0" | "k13_1" | "k13_2" | "k13_3" | "k13_4" | "k13_5" | "k13_6" | "k13_7"; code: 131 | 132 | -133 | 13.5; n13: number }
interface T14 { kind: "k14_0" | "k14_1" | "k14_2" | "k14_3" | "k14_4" | "k14_5" | "k14_6" | "k14_7"; code: 141 | 142 | -143 | 14.5; n14: number }
interface T15 { kind: "k15_0" | "k15_1" | "k15_2" | "k15_3" | "k15_4" | "k15_5" | "k15_6" | "k15_7"; code: 151 | 152 | -153 | 15.5; n15: number }
interface T16 { kind: "k16_0" | "k16_1" | "k16_2" | "k16_3" | "k16_4" | "k16_5" | "k16_6" | "k16_7"; code: 161 | 162 | -163 | 16.5; n16: number }
interface T17 { kind: "k17_0" | "k17_1" | "k17_2" | "k17_3" | "k17_4" | "k17_5" | "k17_6" | "k17_7"; code: 171 | 172 | -173 | 17.5; n17: number }
interface T18 { kind: "k18_0" | "k18_1" | "k18_2" | "k18_3" | "k18_4" | "k18_5" | "k18_6" | "k18_7"; code: 181 | 182 | -183 | 18.5; n18: number }
interface T19 { kind: "k19_0" | "k19_1" | "k19_2" | "k19_3" | "k19_4" | "k19_5" | "k19_6" | "k19_7"; code: 191 | 192 | -193 | 19.5; n19: number }
interface T20 { kind: "k20_0" | "k20_1" | "k20_2" | "k20_3" | "k20_4" | "k20_5" | "k20_6" | "k20_7"; code: 201 | 202 | -203 | 20.5; n20: number }
interface T21 { kind: "k21_0" | "k21_1" | "k21_2" | "k21_3" | "k21_4" | "k21_5" | "k21_6" | "k21_7"; code: 211 | 212 | -213 | 21.5; n21: number }
interface T22 { kind: "k22_0" | "k22_1" | "k22_2" | "k22_3" | "k22_4" | "k22_5" | "k22_6" | "k22_7"; code: 221 | 222 | -223 | 22.5; n22: number }
interface T23 { kind: "k23_0" | "k23_1" | "k23_2" | "k23_3" | "k23_4" | "k23_5" | "k23_6" | "k23_7"; code: 231 | 232 | -233 | 23.5; n23: number }
interface T24 { kind: "k24_0" | "k24_1" | "k24_2" | "k24_3" | "k24_4" | "k24_5" | "k24_6" | "k24_7"; code: 241 | 242 | -243 | 24.5; n24: number }
interface T25 { kind: "k25_0" | "k25_1" | "k25_2" | "k25_3" | "k25_4" | "k25_5" | "k25_6" | "k25_7"; code: 251 | 252 | -253 | 25.5; n25: number }
interface T26 { kind: "k26_0" | "k26_1" | "k26_2" | "k26_3" | "k26_4" | "k26_5" | "k26_6" | "k26_7"; code: 261 | 262 | -263 | 26.5; n26: number }
interface T27 { kind: "k27_0" | "k27_1" | "k27_2" | "k27_3" | "k27_4" | "k27_5" | "k27_6" | "k27_7"; code: 271 | 272 | -273 | 27.5; n27: number }
interface T28 { kind: "k28_0" | "k28_1" | "k28_2" | "k28_3" | "k28_4" | "k28_5" | "k28_6" | "k28_7"; code: 281 | 282 | -283 | 28.5; n28: number }
interface T29 { kind: "k29_0" | "k29_1" | "k29_2" | "k29_3" | "k29_4" | "k29_5" | "k29_6" | "k29_7"; code: 291 | 292 | -293 | 29.5; n29: number }
interface T30 { kind: "k30_0" | "k30_1" | "k30_2" | "k30_3" | "k30_4" | "k30_5" | "k30_6" | "k30_7"; code: 301 | 302 | -303 | 30.5; n30: number }
interface T31 { kind: "k31_0" | "k31_1" | "k31_2" | "k31_3" | "k31_4" | "k31_5" | "k31_6" | "k31_7"; code: 311 | 312 | -313 | 31.5; n31: number }
interface T32 { kind: "k32_0" | "k32_1" | "k32_2" | "k32_3" | "k32_4" | "k32_5" | "k32_6" | "k32_7"; code: 321 | 322 | -323 | 32.5; n32: number }
interface T33 { kind: "k33_0" | "k33_1" | "k33_2" | "k33_3" | "k33_4" | "k33_5" | "k33_6" | "k33_7"; code: 331 | 332 | -333 | 33.5; n33: number }
interface T34 { kind: "k34_0" | "k34_1" | "k34_2" | "k34_3" | "k34_4" | "k34_5" | "k34_6" | "k34_7"; code: 341 | 342 | -343 | 34.5; n34: number }
interface T35 { kind: "k35_0" | "k35_1" | "k35_2" | "k35_3" | "k35_4" | "k35_5" | "k35_6" | "k35_7"; code: 351 | 352 | -353 | 35.5; n35: number }
interface T36 { kind: "k36_0" | "k36_1" | "k36_2" | "k36_3" | "k36_4" | "k36_5" | "k36_6" | "k36_7"; code: 361 | 362 | -363 | 36.5; n36: number }
interface T37 { kind: "k37_0" | "k37_1" | "k37_2" | "k37_3" | "k37_4" | "k37_5" | "k37_6" | "k37_7"; code: 371 | 372 | -373 | 37.5; n37: number }
interface T38 { kind: "k38_0" | "k38_1" | "k38_2" | "k38_3" | "k38_4" | "k38_5" | "k38_6" | "k38_7"; code: 381 | 382 | -383 | 38.5; n38: number }
interface T39 { kind: "k39_0" | "k39_1" | "k39_2" | "k39_3" | "k39_4" | "k39_5" | "k39_6" | "k39_7"; code: 391 | 392 | -393 | 39.5; n39: number }
interface T40 { kind: "k40_0" | "k40_1" | "k40_2" | "k40_3" | "k40_4" | "k40_5" | "k40_6" | "k40_7"; code: 401 | 402 | -403 | 40.5; n40: number }
interface T41 { kind: "k41_0" | "k41_1" | "k41_2" | "k41_3" | "k41_4" | "k41_5" | "k41_6" | "k41_7"; code: 411 | 412 | -413 | 41.5; n41: number }
interface T42 { kind: "k42_0" | "k42_1" | "k42_2" | "k42_3" | "k42_4" | "k42_5" | "k42_6" | "k42_7"; code: 421 | 422 | -423 | 42.5; n42: number }
interface T43 { kind: "k43_0" | "k43_1" | "k43_2" | "k43_3" | "k43_4" | "k43_5" | "k43_6" | "k43_7"; code: 431 | 432 | -433 | 43.5; n43: number }
interface T44 { kind: "k44_0" | "k44_1" | "k44_2" | "k44_3" | "k44_4" | "k44_5" | "k44_6" | "k44_7"; code: 441 | 442 | -443 | 44.5; n44: number }
interface T45 { kind: "k45_0" | "k45_1" | "k45_2" | "k45_3" | "k45_4" | "k45_5" | "k45_6" | "k45_7"; code: 451 | 452 | -453 | 45.5; n45: number }
interface T46 { kind: "k46_0" | "k46_1" | "k46_2" | "k46_3" | "k46_4" | "k46_5" | "k46_6" | "k46_7"; code: 461 | 462 | -463 | 46.5; n46: number }
interface T47 { kind: "k47_0" | "k47_1" | "k47_2" | "k47_3" | "k47_4" | "k47_5" | "k47_6" | "k47_7"; code: 471 | 472 | -473 | 47.5; n47: number }
interface T48 { kind: "k48_0" | "k48_1" | "k48_2" | "k48_3" | "k48_4" | "k48_5" | "k48_6" | "k48_7"; code: 481 | 482 | -483 | 48.5; n48: number }
interface T49 { kind: "k49_0" | "k49_1" | "k49_2" | "k49_3" | "k49_4" | "k49_5" | "k49_6" | "k49_7"; code: 491 | 492 | -493 | 49.5; n49: number }
interface T50 { kind: "k50_0" | "k50_1" | "k50_2" | "k50_3" | "k50_4" | "k50_5" | "k50_6" | "k50_7"; code: 501 | 502 | -503 | 50.5; n50: number }
interface T51 { kind: "k51_0" | "k51_1" | "k51_2" | "k51_3" | "k51_4" | "k51_5" | "k51_6" | "k51_7"; code: 511 | 512 | -513 | 51.5; n51: number }
interface T52 { kind: "k52_0" | "k52_1" | "k52_2" | "k52_3" | "k52_4" | "k52_5" | "k52_6" | "k52_7"; code: 521 | 522 | -523 | 52.5; n52: number }
interface T53 { kind: "k53_0" | "k53_1" | "k53_2" | "k53_3" | "k53_4" | "k53_5" | "k53_6" | "k53_7"; code: 531 | 532 | -533 | 53.5; n53: number }
interface T54 { kind: "k54_0" | "k54_1" | "k54_2" | "k54_3" | "k54_4" | "k54_5" | "k54_6" | "k54_7"; code: 541 | 542 | -543 | 54.5; n54: number }
interface T55 { kind: "k55_0" | "k55_1" | "k55_2" | "k55_3" | "k55_4" | "k55_5" | "k55_6" | "k55_7"; code: 551 | 552 | -553 | 55.5; n55: number }
interface T56 { kind: "k56_0" | "k56_1" | "k56_2" | "k56_3" | "k56_4" | "k56_5" | "k56_6" | "k56_7"; code: 561 | 562 | -563 | 56.5; n56: number }
interface T57 { kind: "k57_0" | "k57_1" | "k57_2" | "k57_3" | "k57_4" | "k57_5" | "k57_6" | "k57_7"; code: 571 | 572 | -573 | 57.5; n57: number }
interface T58 { kind: "k58_0" | "k58_1" | "k58_2" | "k58_3" | "k58_4" | "k58_5" | "k58_6" | "k58_7"; code: 581 | 582 | -583 | 58.5; n58: number }
interface T59 { kind: "k59_0" | "k59_1" | "k59_2" | "k59_3" | "k59_4" | "k59_5" | "k59_6" | "k59_7"; code: 591 | 592 | -593 | 59.5; n59: number }
interface T60 { kind: "k60_0" | "k60_1" | "k60_2" | "k60_3" | "k60_4" | "k60_5" | "k60_6" | "k60_7"; code: 601 | 602 | -603 | 60.5; n60: number }
interface T61 { kind: "k61_0" | "k61_1" | "k61_2" | "k61_3" | "k61_4" | "k61_5" | "k61_6" | "k61_7"; code: 611 | 612 | -613 | 61.5; n61: number }
interface T62 { kind: "k62_0" | "k62_1" | "k62_2" | "k62_3" | "k62_4" | "k62_5" | "k62_6" | "k62_7"; code: 621 | 622 | -623 | 62.5; n62: number }
interface T63 { kind: "k63_0" | "k63_1" | "k63_2" | "k63_3" | "k63_4" | "k63_5" | "k63_6" | "k63_7"; code: 631 | 632 | -633 | 63.5; n63: number }
interface T64 { kind: "k64_0" | "k64_1" | "k64_2" | "k64_3" | "k64_4" | "k64_5" | "k64_6" | "k64_7"; code: 641 | 642 | -643 | 64.5; n64: number }
interface T65 { kind: "k65_0" | "k65_1" | "k65_2" | "k65_3" | "k65_4" | "k65_5" | "k65_6" | "k65_7"; code: 651 | 652 | -653 | 65.5; n65: number }
interface T66 { kind: "k66_0" | "k66_1" | "k66_2" | "k66_3" | "k66_4" | "k66_5" | "k66_6" | "k66_7"; code: 661 | 662 | -663 | 66.5; n66: number }
interface T67 { kind: "k67_0" | "k67_1" | "k67_2" | "k67_3" | "k67_4" | "k67_5" | "k67_6" | "k67_7"; code: 671 | 672 | -673 | 67.5; n67: number }
interface T68 { kind: "k68_0" | "k68_1" | "k68_2" | "k68_3" | "k68_4" | "k68_5" | "k68_6" | "k68_7"; code: 681 | 682 | -683 | 68.5; n68: number }
interface T69 { kind: "k69_0" | "k69_1" | "k69_2" | "k69_3" | "k69_4" | "k69_5" | "k69_6" | "k69_7"; code: 691 | 692 | -693 | 69.5; n69: number }
interface T70 { kind: "k70_0" | "k70_1" | "k70_2" | "k70_3" | "k70_4" | "k70_5" | "k70_6" | "k70_7"; code: 701 | 702 | -703 | 70.5; n70: number }
interface T71 { kind: "k71_0" | "k71_1" | "k71_2" | "k71_3" | "k71_4" | "k71_5" | "k71_6" | "k71_7"; code: 711 | 712 | -713 | 71.5; n71: number }
interface T72 { kind: "k72_0" | "k72_1" | "k72_2" | "k72_3" | "k72_4" | "k72_5" | "k72_6" | "k72_7"; code: 721 | 722 | -723 | 72.5; n72: number }
interface T73 { kind: "k73_0" | "k73_1" | "k73_2" | "k73_3" | "k73_4" | "k73_5" | "k73_6" | "k73_7"; code: 731 | 732 | -733 | 73.5; n73: number }
interface T74 { kind: "k74_0" | "k74_1" | "k74_2" | "k74_3" | "k74_4" | "k74_5" | "k74_6" | "k74_7"; code: 741 | 742 | -743 | 74.5; n74: number }
interface T75 { kind: "k75_0" | "k75_1" | "k75_2" | "k75_3" | "k75_4" | "k75_5" | "k75_6" | "k75_7"; code: 751 | 752 | -753 | 75.5; n75: number }
interface T76 { kind: "k76_0" | "k76_1" | "k76_2" | "k76_3" | "k76_4" | "k76_5" | "k76_6" | "k76_7"; code: 761 | 762 | -763 | 76.5; n76: number }
interface T77 { kind: "k77_0" | "k77_1" | "k77_2" | "k77_3" | "k77_4" | "k77_5" | "k77_6" | "k77_7"; code: 771 | 772 | -773 | 77.5; n77: number }
interface T78 { kind: "k78_0" | "k78_1" | "k78_2" | "k78_3" | "k78_4" | "k78_5" | "k78_6" | "k78_7"; code: 781 | 782 | -783 | 78.5; n78: number }
interface T79 { kind: "k79_0" | "k79_1" | "k79_2" | "k79_3" | "k79_4" | "k79_5" | "k79_6" | "k79_7"; code: 791 | 792 | -793 | 79.5; n79: number }
interface T80 { kind: "k80_0" | "k80_1" | "k80_2" | "k80_3" | "k80_4" | "k80_5" | "k80_6" | "k80_7"; code: 801 | 802 | -803 | 80.5; n80: number }
interface T81 { kind: "k81_0" | "k81_1" | "k81_2" | "k81_3" | "k81_4" | "k81_5" | "k81_6" | "k81_7"; code: 811 | 812 | -813 | 81.5; n81: number }
interface T82 { kind: "k82_0" | "k82_1" | "k82_2" | "k82_3" | "k82_4" | "k82_5" | "k82_6" | "k82_7"; code: 821 | 822 | -823 | 82.5; n82: number }
interface T83 { kind: "k83_0" | "k83_1" | "k83_2" | "k83_3" | "k83_4" | "k83_5" | "k83_6" | "k83_7"; code: 831 | 832 | -833 | 83.5; n83: number }
interface T84 { kind: "k84_0" | "k84_1" | "k84_2" | "k84_3" | "k84_4" | "k84_5" | "k84_6" | "k84_7"; code: 841 | 842 | -843 | 84.5; n84: number }
interface T85 { kind: "k85_0" | "k85_1" | "k85_2" | "k85_3" | "k85_4" | "k85_5" | "k85_6" | "k85_7"; code: 851 | 852 | -853 | 85.5; n85: number }
interface T86 { kind: "k86_0" | "k86_1" | "k86_2" | "k86_3" | "k86_4" | "k86_5" | "k86_6" | "k86_7"; code: 861 | 862 | -863 | 86.5; n86: number }
interface T87 { kind: "k87_0" | "k87_1" | "k87_2" | "k87_3" | "k87_4" | "k87_5" | "k87_6" | "k87_7"; code: 871 | 872 | -873 | 87.5; n87: number }
interface T88 { kind: "k88_0" | "k88_1" | "k88_2" | "k88_3" | "k88_4" | "k88_5" | "k88_6" | "k88_7"; code: 881 | 882 | -883 | 88.5; n88: number }
interface T89 { kind: "k89_0" | "k89_1" | "k89_2" | "k89_3" | "k89_4" | "k89_5" | "k89_6" | "k89_7"; code: 891 | 892 | -893 | 89.5; n89: number }
interface T90 { kind: "k90_0" | "k90_1" | "k90_2" | "k90_3" | "k90_4" | "k90_5" | "k90_6" | "k90_7"; code: 901 | 902 | -903 | 90.5; n90: number }
interface T91 { kind: "k91_0" | "k91_1" | "k91_2" | "k91_3" | "k91_4" | "k91_5" | "k91_6" | "k91_7"; code: 911 | 912 | -913 | 91.5; n91: number }
interface T92 { kind: "k92_0" | "k92_1" | "k92_2" | "k92_3" | "k92_4" | "k92_5" | "k92_6" | "k92_7"; code: 921 | 922 | -923 | 92.5; n92: number }
interface T93 { kind: "k93_0" | "k93_1" | "k93_2" | "k93_3" | "k93_4" | "k93_5" | "k93_6" | "k93_7"; code: 931 | 932 | -933 | 93.5; n93: number }
interface T94 { kind: "k94_0" | "k94_1" | "k94_2" | "k94_3" | "k94_4" | "k94_5" | "k94_6" | "k94_7"; code: 941 | 942 | -943 | 94.5; n94: number }
interface T95 { kind: "k95_0" | "k95_1" | "k95_2" | "k95_3" | "k95_4" | "k95_5" | "k95_6" | "k95_7"; code: 951 | 952 | -953 | 95.5; n95: number }
interface T96 { kind: "k96_0" | "k96_1" | "k96_2" | "k96_3" | "k96_4" | "k96_5" | "k96_6" | "k96_7"; code: 961 | 962 | -963 | 96.5; n96: number }
interface T97 { kind: "k97_0" | "k97_1" | "k97_2" | "k97_3" | "k97_4" | "k97_5" | "k97_6" | "k97_7"; code: 971 | 972 | -973 | 97.5; n97: number }
interface T98 { kind: "k98_0" | "k98_1" | "k98_2" | "k98_3" | "k98_4" | "k98_5" | "k98_6" | "k98_7"; code: 981 | 982 | -983 | 98.5; n98: number }
interface T99 { kind: "k99_0" | "k99_1" | "k99_2" | "k99_3" | "k99_4" | "k99_5" | "k99_6" | "k99_7"; code: 991 | 992 | -993 | 99.5; n99: number }
interface T100 { kind: "k100_0" | "k100_1" | "k100_2" | "k100_3" | "k100_4" | "k100_5" | "k100_6" | "k100_7"; code: 1001 | 1002 | -1003 | 100.5; n100: number }
interface T101 { kind: "k101_0" | "k101_1" | "k101_2" | "k101_3" | "k101_4" | "k101_5" | "k101_6" | "k101_7"; code: 1011 | 1012 | -1013 | 101.5; n101: number }
interface T102 { kind: "k102_0" | "k102_1" | "k102_2" | "k102_3" | "k102_4" | "k102_5" | "k102_6" | "k102_7"; code: 1021 | 1022 | -1023 | 102.5; n102: number }
interface T103 { kind: "k103_0" | "k103_1" | "k103_2" | "k103_3" | "k103_4" | "k103_5" | "k103_6" | "k103_7"; code: 1031 | 1032 | -1033 | 103.5; n103: number }
interface T104 { kind: "k104_0" | "k104_1" | "k104_2" | "k104_3" | "k104_4" | "k104_5" | "k104_6" | "k104_7"; code: 1041 | 1042 | -1043 | 104.5; n104: number }
interface T105 { kind: "k105_0" | "k105_1" | "k105_2" | "k105_3" | "k105_4" | "k105_5" | "k105_6" | "k105_7"; code: 1051 | 1052 | -1053 | 105.5; n105: number }
interface T106 { kind: "k106_0" | "k106_1" | "k106_2" | "k106_3" | "k106_4" | "k106_5" | "k106_6" | "k106_7"; code: 1061 | 1062 | -1063 | 106.5; n106: number }
interface T107 { kind: "k107_0" | "k107_1" | "k107_2" | "k107_3" | "k107_4" | "k107_5" | "k107_6" | "k107_7"; code: 1071 | 1072 | -1073 | 107.5; n107: number }
interface T108 { kind: "k108_0" | "k108_1" | "k108_2" | "k108_3" | "k108_4" | "k108_5" | "k108_6" | "k108_7"; code: 1081 | 1082 | -1083 | 108.5; n108: number }
interface T109 { kind: "k109_0" | "k109_1" | "k109_2" | "k109_3" | "k109_4" | "k109_5" | "k109_6" | "k109_7"; code: 1091 | 1092 | -1093 | 109.5; n109: number }
interface T110 { kind: "k110_0" | "k110_1" | "k110_2" | "k110_3" | "k110_4" | "k110_5" | "k110_6" | "k110_7"; code: 1101 | 1102 | -1103 | 110.5; n110: number }
interface T111 { kind: "k111_0" | "k111_1" | "k111_2" | "k111_3" | "k111_4" | "k111_5" | "k111_6" | "k111_7"; code: 1111 | 1112 | -1113 | 111.5; n111: number }
interface T112 { kind: "k112_0" | "k112_1" | "k112_2" | "k112_3" | "k112_4" | "k112_5" | "k112_6" | "k112_7"; code: 1121 | 1122 | -1123 | 112.5; n112: number }
interface T113 { kind: "k113_0" | "k113_1" | "k113_2" | "k113_3" | "k113_4" | "k113_5" | "k113_6" | "k113_7"; code: 1131 | 1132 | -1133 | 113.5; n113: number }
interface T114 { kind: "k114_0" | "k114_1" | "k114_2" | "k114_3" | "k114_4" | "k114_5" | "k114_6" | "k114_7"; code: 1141 | 1142 | -1143 | 114.5; n114: number }
interface T115 { kind: "k115_0" | "k115_1" | "k115_2" | "k115_3" | "k115_4" | "k115_5" | "k115_6" | "k115_7"; code: 1151 | 1152 | -1153 | 115.5; n115: number }
interface T116 { kind: "k116_0" | "k116_1" | "k116_2" | "k116_3" | "k116_4" | "k116_5" | "k116_6" | "k116_7"; code: 1161 | 1162 | -1163 | 116.5; n116: number }
interface T117 { kind: "k117_0" | "k117_1" | "k117_2" | "k117_3" | "k117_4" | "k117_5" | "k117_6" | "k117_7"; code: 1171 | 1172 | -1173 | 117.5; n117: number }
interface T118 { kind: "k118_0" | "k118_1" | "k118_2" | "k118_3" | "k118_4" | "k118_5" | "k118_6" | "k118_7"; code: 1181 | 1182 | -1183 | 118.5; n118: number }
interface T119 { kind: "k119_0" | "k119_1" | "k119_2" | "k119_3" | "k119_4" | "k119_5" | "k119_6" | "k119_7"; code: 1191 | 1192 | -1193 | 119.5; n119: number }
const made: unknown[] = []
{ const v: T0 = { kind: "k0_3", code: 0.5, n0: 0 }; made.push(v) }
{ const v: T1 = { kind: "k1_3", code: 1.5, n1: 1 }; made.push(v) }
{ const v: T2 = { kind: "k2_3", code: 2.5, n2: 2 }; made.push(v) }
{ const v: T3 = { kind: "k3_3", code: 3.5, n3: 3 }; made.push(v) }
{ const v: T4 = { kind: "k4_3", code: 4.5, n4: 4 }; made.push(v) }
{ const v: T5 = { kind: "k5_3", code: 5.5, n5: 5 }; made.push(v) }
{ const v: T6 = { kind: "k6_3", code: 6.5, n6: 6 }; made.push(v) }
{ const v: T7 = { kind: "k7_3", code: 7.5, n7: 7 }; made.push(v) }
{ const v: T8 = { kind: "k8_3", code: 8.5, n8: 8 }; made.push(v) }
{ const v: T9 = { kind: "k9_3", code: 9.5, n9: 9 }; made.push(v) }
{ const v: T10 = { kind: "k10_3", code: 10.5, n10: 10 }; made.push(v) }
{ const v: T11 = { kind: "k11_3", code: 11.5, n11: 11 }; made.push(v) }
{ const v: T12 = { kind: "k12_3", code: 12.5, n12: 12 }; made.push(v) }
{ const v: T13 = { kind: "k13_3", code: 13.5, n13: 13 }; made.push(v) }
{ const v: T14 = { kind: "k14_3", code: 14.5, n14: 14 }; made.push(v) }
{ const v: T15 = { kind: "k15_3", code: 15.5, n15: 15 }; made.push(v) }
{ const v: T16 = { kind: "k16_3", code: 16.5, n16: 16 }; made.push(v) }
{ const v: T17 = { kind: "k17_3", code: 17.5, n17: 17 }; made.push(v) }
{ const v: T18 = { kind: "k18_3", code: 18.5, n18: 18 }; made.push(v) }
{ const v: T19 = { kind: "k19_3", code: 19.5, n19: 19 }; made.push(v) }
{ const v: T20 = { kind: "k20_3", code: 20.5, n20: 20 }; made.push(v) }
{ const v: T21 = { kind: "k21_3", code: 21.5, n21: 21 }; made.push(v) }
{ const v: T22 = { kind: "k22_3", code: 22.5, n22: 22 }; made.push(v) }
{ const v: T23 = { kind: "k23_3", code: 23.5, n23: 23 }; made.push(v) }
{ const v: T24 = { kind: "k24_3", code: 24.5, n24: 24 }; made.push(v) }
{ const v: T25 = { kind: "k25_3", code: 25.5, n25: 25 }; made.push(v) }
{ const v: T26 = { kind: "k26_3", code: 26.5, n26: 26 }; made.push(v) }
{ const v: T27 = { kind: "k27_3", code: 27.5, n27: 27 }; made.push(v) }
{ const v: T28 = { kind: "k28_3", code: 28.5, n28: 28 }; made.push(v) }
{ const v: T29 = { kind: "k29_3", code: 29.5, n29: 29 }; made.push(v) }
{ const v: T30 = { kind: "k30_3", code: 30.5, n30: 30 }; made.push(v) }
{ const v: T31 = { kind: "k31_3", code: 31.5, n31: 31 }; made.push(v) }
{ const v: T32 = { kind: "k32_3", code: 32.5, n32: 32 }; made.push(v) }
{ const v: T33 = { kind: "k33_3", code: 33.5, n33: 33 }; made.push(v) }
{ const v: T34 = { kind: "k34_3", code: 34.5, n34: 34 }; made.push(v) }
{ const v: T35 = { kind: "k35_3", code: 35.5, n35: 35 }; made.push(v) }
{ const v: T36 = { kind: "k36_3", code: 36.5, n36: 36 }; made.push(v) }
{ const v: T37 = { kind: "k37_3", code: 37.5, n37: 37 }; made.push(v) }
{ const v: T38 = { kind: "k38_3", code: 38.5, n38: 38 }; made.push(v) }
{ const v: T39 = { kind: "k39_3", code: 39.5, n39: 39 }; made.push(v) }
{ const v: T40 = { kind: "k40_3", code: 40.5, n40: 40 }; made.push(v) }
{ const v: T41 = { kind: "k41_3", code: 41.5, n41: 41 }; made.push(v) }
{ const v: T42 = { kind: "k42_3", code: 42.5, n42: 42 }; made.push(v) }
{ const v: T43 = { kind: "k43_3", code: 43.5, n43: 43 }; made.push(v) }
{ const v: T44 = { kind: "k44_3", code: 44.5, n44: 44 }; made.push(v) }
{ const v: T45 = { kind: "k45_3", code: 45.5, n45: 45 }; made.push(v) }
{ const v: T46 = { kind: "k46_3", code: 46.5, n46: 46 }; made.push(v) }
{ const v: T47 = { kind: "k47_3", code: 47.5, n47: 47 }; made.push(v) }
{ const v: T48 = { kind: "k48_3", code: 48.5, n48: 48 }; made.push(v) }
{ const v: T49 = { kind: "k49_3", code: 49.5, n49: 49 }; made.push(v) }
{ const v: T50 = { kind: "k50_3", code: 50.5, n50: 50 }; made.push(v) }
{ const v: T51 = { kind: "k51_3", code: 51.5, n51: 51 }; made.push(v) }
{ const v: T52 = { kind: "k52_3", code: 52.5, n52: 52 }; made.push(v) }
{ const v: T53 = { kind: "k53_3", code: 53.5, n53: 53 }; made.push(v) }
{ const v: T54 = { kind: "k54_3", code: 54.5, n54: 54 }; made.push(v) }
{ const v: T55 = { kind: "k55_3", code: 55.5, n55: 55 }; made.push(v) }
{ const v: T56 = { kind: "k56_3", code: 56.5, n56: 56 }; made.push(v) }
{ const v: T57 = { kind: "k57_3", code: 57.5, n57: 57 }; made.push(v) }
{ const v: T58 = { kind: "k58_3", code: 58.5, n58: 58 }; made.push(v) }
{ const v: T59 = { kind: "k59_3", code: 59.5, n59: 59 }; made.push(v) }
{ const v: T60 = { kind: "k60_3", code: 60.5, n60: 60 }; made.push(v) }
{ const v: T61 = { kind: "k61_3", code: 61.5, n61: 61 }; made.push(v) }
{ const v: T62 = { kind: "k62_3", code: 62.5, n62: 62 }; made.push(v) }
{ const v: T63 = { kind: "k63_3", code: 63.5, n63: 63 }; made.push(v) }
{ const v: T64 = { kind: "k64_3", code: 64.5, n64: 64 }; made.push(v) }
{ const v: T65 = { kind: "k65_3", code: 65.5, n65: 65 }; made.push(v) }
{ const v: T66 = { kind: "k66_3", code: 66.5, n66: 66 }; made.push(v) }
{ const v: T67 = { kind: "k67_3", code: 67.5, n67: 67 }; made.push(v) }
{ const v: T68 = { kind: "k68_3", code: 68.5, n68: 68 }; made.push(v) }
{ const v: T69 = { kind: "k69_3", code: 69.5, n69: 69 }; made.push(v) }
{ const v: T70 = { kind: "k70_3", code: 70.5, n70: 70 }; made.push(v) }
{ const v: T71 = { kind: "k71_3", code: 71.5, n71: 71 }; made.push(v) }
{ const v: T72 = { kind: "k72_3", code: 72.5, n72: 72 }; made.push(v) }
{ const v: T73 = { kind: "k73_3", code: 73.5, n73: 73 }; made.push(v) }
{ const v: T74 = { kind: "k74_3", code: 74.5, n74: 74 }; made.push(v) }
{ const v: T75 = { kind: "k75_3", code: 75.5, n75: 75 }; made.push(v) }
{ const v: T76 = { kind: "k76_3", code: 76.5, n76: 76 }; made.push(v) }
{ const v: T77 = { kind: "k77_3", code: 77.5, n77: 77 }; made.push(v) }
{ const v: T78 = { kind: "k78_3", code: 78.5, n78: 78 }; made.push(v) }
{ const v: T79 = { kind: "k79_3", code: 79.5, n79: 79 }; made.push(v) }
{ const v: T80 = { kind: "k80_3", code: 80.5, n80: 80 }; made.push(v) }
{ const v: T81 = { kind: "k81_3", code: 81.5, n81: 81 }; made.push(v) }
{ const v: T82 = { kind: "k82_3", code: 82.5, n82: 82 }; made.push(v) }
{ const v: T83 = { kind: "k83_3", code: 83.5, n83: 83 }; made.push(v) }
{ const v: T84 = { kind: "k84_3", code: 84.5, n84: 84 }; made.push(v) }
{ const v: T85 = { kind: "k85_3", code: 85.5, n85: 85 }; made.push(v) }
{ const v: T86 = { kind: "k86_3", code: 86.5, n86: 86 }; made.push(v) }
{ const v: T87 = { kind: "k87_3", code: 87.5, n87: 87 }; made.push(v) }
{ const v: T88 = { kind: "k88_3", code: 88.5, n88: 88 }; made.push(v) }
{ const v: T89 = { kind: "k89_3", code: 89.5, n89: 89 }; made.push(v) }
{ const v: T90 = { kind: "k90_3", code: 90.5, n90: 90 }; made.push(v) }
{ const v: T91 = { kind: "k91_3", code: 91.5, n91: 91 }; made.push(v) }
{ const v: T92 = { kind: "k92_3", code: 92.5, n92: 92 }; made.push(v) }
{ const v: T93 = { kind: "k93_3", code: 93.5, n93: 93 }; made.push(v) }
{ const v: T94 = { kind: "k94_3", code: 94.5, n94: 94 }; made.push(v) }
{ const v: T95 = { kind: "k95_3", code: 95.5, n95: 95 }; made.push(v) }
{ const v: T96 = { kind: "k96_3", code: 96.5, n96: 96 }; made.push(v) }
{ const v: T97 = { kind: "k97_3", code: 97.5, n97: 97 }; made.push(v) }
{ const v: T98 = { kind: "k98_3", code: 98.5, n98: 98 }; made.push(v) }
{ const v: T99 = { kind: "k99_3", code: 99.5, n99: 99 }; made.push(v) }
{ const v: T100 = { kind: "k100_3", code: 100.5, n100: 100 }; made.push(v) }
{ const v: T101 = { kind: "k101_3", code: 101.5, n101: 101 }; made.push(v) }
{ const v: T102 = { kind: "k102_3", code: 102.5, n102: 102 }; made.push(v) }
{ const v: T103 = { kind: "k103_3", code: 103.5, n103: 103 }; made.push(v) }
{ const v: T104 = { kind: "k104_3", code: 104.5, n104: 104 }; made.push(v) }
{ const v: T105 = { kind: "k105_3", code: 105.5, n105: 105 }; made.push(v) }
{ const v: T106 = { kind: "k106_3", code: 106.5, n106: 106 }; made.push(v) }
{ const v: T107 = { kind: "k107_3", code: 107.5, n107: 107 }; made.push(v) }
{ const v: T108 = { kind: "k108_3", code: 108.5, n108: 108 }; made.push(v) }
{ const v: T109 = { kind: "k109_3", code: 109.5, n109: 109 }; made.push(v) }
{ const v: T110 = { kind: "k110_3", code: 110.5, n110: 110 }; made.push(v) }
{ const v: T111 = { kind: "k111_3", code: 111.5, n111: 111 }; made.push(v) }
{ const v: T112 = { kind: "k112_3", code: 112.5, n112: 112 }; made.push(v) }
{ const v: T113 = { kind: "k113_3", code: 113.5, n113: 113 }; made.push(v) }
{ const v: T114 = { kind: "k114_3", code: 114.5, n114: 114 }; made.push(v) }
{ const v: T115 = { kind: "k115_3", code: 115.5, n115: 115 }; made.push(v) }
{ const v: T116 = { kind: "k116_3", code: 116.5, n116: 116 }; made.push(v) }
{ const v: T117 = { kind: "k117_3", code: 117.5, n117: 117 }; made.push(v) }
{ const v: T118 = { kind: "k118_3", code: 118.5, n118: 118 }; made.push(v) }
{ const v: T119 = { kind: "k119_3", code: 119.5, n119: 119 }; made.push(v) }
console.log(JSON.stringify(made).length)
attempt("a literal that is listed", () => { const v: T7 = hide(JSON.parse('{"kind":"k7_5","code":-73,"n7":1}')); return v })
attempt("a string that is not listed", () => { const v: T7 = hide(JSON.parse('{"kind":"k8_5","code":-73,"n7":1}')); return v })
attempt("a number that is not listed", () => { const v: T7 = hide(JSON.parse('{"kind":"k7_5","code":73,"n7":1}')); return v })
attempt("a fraction that is listed", () => { const v: T7 = hide(JSON.parse('{"kind":"k7_0","code":7.5,"n7":1}')); return v })
attempt("stored from untyped code, listed", () => { const v: T9 = { kind: "k9_0", code: 91, n9: 0 }; hide(v).kind = "k9_7"; hide(v).code = 9.5; return v })
attempt("stored from untyped code, not listed", () => { const v: T9 = { kind: "k9_0", code: 91, n9: 0 }; hide(v).kind = "k9_8"; return v })
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number } | { kind: "none" }
function area(s: Shape) { return s.kind === "circle" ? 3 * s.r * s.r : s.kind === "square" ? s.side * s.side : 0 }
for (const text of ['{"kind":"circle","r":2}', '{"kind":"square","side":3}', '{"kind":"none"}', '{"kind":"line"}']) attempt(text, () => area(JSON.parse(text) as Shape))
class C0 { f0 = 0; m0() { return 0 } }
class C1 extends C0 { f1 = 1; m1() { return 1 } }
class C2 extends C1 { f2 = 2; m2() { return 2 } }
class C3 extends C2 { f3 = 3; m3() { return 3 } }
class C4 extends C3 { f4 = 4; m4() { return 4 } }
class C5 extends C4 { f5 = 5; m5() { return 5 } }
class C6 extends C5 { f6 = 6; m6() { return 6 } }
class C7 extends C6 { f7 = 7; m7() { return 7 } }
class C8 { f8 = 8; m8() { return 8 } }
class C9 extends C8 { f9 = 9; m9() { return 9 } }
class C10 extends C9 { f10 = 10; m10() { return 10 } }
class C11 extends C10 { f11 = 11; m11() { return 11 } }
class C12 extends C11 { f12 = 12; m12() { return 12 } }
class C13 extends C12 { f13 = 13; m13() { return 13 } }
class C14 extends C13 { f14 = 14; m14() { return 14 } }
class C15 extends C14 { f15 = 15; m15() { return 15 } }
class C16 { f16 = 16; m16() { return 16 } }
class C17 extends C16 { f17 = 17; m17() { return 17 } }
class C18 extends C17 { f18 = 18; m18() { return 18 } }
class C19 extends C18 { f19 = 19; m19() { return 19 } }
class C20 extends C19 { f20 = 20; m20() { return 20 } }
class C21 extends C20 { f21 = 21; m21() { return 21 } }
class C22 extends C21 { f22 = 22; m22() { return 22 } }
class C23 extends C22 { f23 = 23; m23() { return 23 } }
class C24 { f24 = 24; m24() { return 24 } }
class C25 extends C24 { f25 = 25; m25() { return 25 } }
class C26 extends C25 { f26 = 26; m26() { return 26 } }
class C27 extends C26 { f27 = 27; m27() { return 27 } }
class C28 extends C27 { f28 = 28; m28() { return 28 } }
class C29 extends C28 { f29 = 29; m29() { return 29 } }
class C30 extends C29 { f30 = 30; m30() { return 30 } }
class C31 extends C30 { f31 = 31; m31() { return 31 } }
class C32 { f32 = 32; m32() { return 32 } }
class C33 extends C32 { f33 = 33; m33() { return 33 } }
class C34 extends C33 { f34 = 34; m34() { return 34 } }
class C35 extends C34 { f35 = 35; m35() { return 35 } }
class C36 extends C35 { f36 = 36; m36() { return 36 } }
class C37 extends C36 { f37 = 37; m37() { return 37 } }
class C38 extends C37 { f38 = 38; m38() { return 38 } }
class C39 extends C38 { f39 = 39; m39() { return 39 } }
const last: any = hide(new C39)
console.log(last.m39(), last.m35(), last.m32(), last.m31, last instanceof C32, last instanceof C31, Object.keys(last).join())
console.log(Object.getPrototypeOf(Object.getPrototypeOf(last)) === C38.prototype, Object.getOwnPropertyNames(C33.prototype).join(), hide(C36).name, Object.getPrototypeOf(C36) === C35)
