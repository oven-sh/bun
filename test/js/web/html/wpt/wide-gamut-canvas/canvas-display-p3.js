// Each PNG:
//  * is 2x2 and has a single color
//  * has a filename that indicates its contents:
//      <embedded-profile>-<8-or-16-bit-color-value>.png
//  * was generated using ImageMagick commands like:
//      convert -size 2x2 xc:'#BB0000FF' -profile Display-P3.icc Display-P3-BB0000FF.png
//      convert -size 2x2 xc:'#BBBC00000000FFFF' -profile Adobe-RGB.icc Adobe-RGB-BBBC00000000FFFF.png

// Top level key is the image filename. Second level key is the pair of
// CanvasRenderingContext2DSettings.colorSpace and ImageDataSettings.colorSpace.
const imageTests = {
    // 8 bit source images

    "sRGB-FF0000FF.png": {
        "srgb srgb": [255, 0, 0, 255],
        "srgb display-p3": [234, 51, 35, 255],
        "display-p3 srgb": [255, 0, 0, 255],
        "display-p3 display-p3": [234, 51, 35, 255],
    },
    "sRGB-FF0000CC.png": {
        "srgb srgb": [255, 0, 0, 204],
        "srgb display-p3": [234, 51, 35, 204],
        "display-p3 srgb": [255, 0, 0, 204],
        "display-p3 display-p3": [234, 51, 35, 204],
    },
    "sRGB-BB0000FF.png": {
        "srgb srgb": [187, 0, 0, 255],
        "srgb display-p3": [171, 35, 23, 255],
        "display-p3 srgb": [187, 1, 0, 255],
        "display-p3 display-p3": [171, 35, 23, 255],
    },
    "sRGB-BB0000CC.png": {
        "srgb srgb": [187, 0, 0, 204],
        "srgb display-p3": [171, 35, 23, 204],
        "display-p3 srgb": [187, 1, 0, 204],
        "display-p3 display-p3": [171, 35, 23, 204],
    },

    "Display-P3-FF0000FF.png": {
        "srgb srgb": [255, 0, 0, 255],
        "srgb display-p3": [234, 51, 35, 255],
        "display-p3 srgb": [255, 0, 0, 255],
        "display-p3 display-p3": [255, 0, 0, 255],
    },
    "Display-P3-FF0000CC.png": {
        "srgb srgb": [255, 0, 0, 204],
        "srgb display-p3": [234, 51, 35, 204],
        "display-p3 srgb": [255, 0, 0, 204],
        "display-p3 display-p3": [255, 0, 0, 204],
    },
    "Display-P3-BB0000FF.png": {
        "srgb srgb": [205, 0, 0, 255],
        "srgb display-p3": [188, 39, 26, 255],
        "display-p3 srgb": [205, 0, 0, 255],
        "display-p3 display-p3": [187, 0, 0, 255],
    },
    "Display-P3-BB0000CC.png": {
        "srgb srgb": [205, 0, 0, 204],
        "srgb display-p3": [188, 39, 26, 204],
        "display-p3 srgb": [205, 0, 0, 204],
        "display-p3 display-p3": [187, 0, 0, 204],
    },

    "Adobe-RGB-FF0000FF.png": {
        "srgb srgb": [255, 0, 0, 255],
        "srgb display-p3": [234, 51, 35, 255],
        "display-p3 srgb": [255, 19, 11, 255],
        "display-p3 display-p3": [255, 61, 43, 255],
    },
    "Adobe-RGB-FF0000CC.png": {
        "srgb srgb": [255, 0, 0, 204],
        "srgb display-p3": [234, 51, 35, 204],
        "display-p3 srgb": [255, 19, 11, 204],
        "display-p3 display-p3": [255, 61, 43, 204],
    },
    "Adobe-RGB-BB0000FF.png": {
        "srgb srgb": [219, 0, 0, 255],
        "srgb display-p3": [201, 42, 29, 255],
        "display-p3 srgb": [219, 0, 1, 255],
        "display-p3 display-p3": [201, 42, 29, 255],
    },
    "Adobe-RGB-BB0000CC.png": {
        "srgb srgb": [219, 0, 0, 204],
        "srgb display-p3": [201, 42, 29, 204],
        "display-p3 srgb": [219, 0, 1, 204],
        "display-p3 display-p3": [201, 42, 29, 204],
    },

    "Generic-CMYK-FF000000.jpg": {
        "srgb srgb": [0, 163, 218, 255],
        "srgb display-p3": [72, 161, 213, 255],
        "display-p3 srgb": [0, 163, 218, 255],
        "display-p3 display-p3": [0, 160, 213, 255],
    },
    "Generic-CMYK-BE000000.jpg": {
        "srgb srgb": [0, 180, 223, 255],
        "srgb display-p3": [80, 177, 219, 255],
        "display-p3 srgb": [0, 180, 223, 255],
        "display-p3 display-p3": [65, 177, 219, 255],
    },

    // 16 bit source images

    "sRGB-FFFF00000000FFFF.png": {
        "srgb srgb": [255, 0, 0, 255],
        "srgb display-p3": [234, 51, 35, 255],
        "display-p3 srgb": [255, 0, 0, 255],
        "display-p3 display-p3": [234, 51, 35, 255],
    },
    "sRGB-FFFF00000000CCCC.png": {
        "srgb srgb": [255, 0, 0, 204],
        "srgb display-p3": [234, 51, 35, 204],
        "display-p3 srgb": [255, 0, 0, 204],
        "display-p3 display-p3": [234, 51, 35, 204],
    },
    "sRGB-BBBC00000000FFFF.png": {
        "srgb srgb": [187, 0, 0, 255],
        "srgb display-p3": [171, 35, 23, 255],
        "display-p3 srgb": [187, 1, 0, 255],
        "display-p3 display-p3": [171, 35, 23, 255],
    },
    "sRGB-BBBC00000000CCCC.png": {
        "srgb srgb": [187, 0, 0, 204],
        "srgb display-p3": [171, 35, 23, 204],
        "display-p3 srgb": [187, 1, 0, 204],
        "display-p3 display-p3": [171, 35, 23, 204],
    },

    "Display-P3-FFFF00000000FFFF.png": {
        "srgb srgb": [255, 0, 0, 255],
        "srgb display-p3": [234, 51, 35, 255],
        "display-p3 srgb": [255, 0, 0, 255],
        "display-p3 display-p3": [255, 0, 0, 255],
    },
    "Display-P3-FFFF00000000CCCC.png": {
        "srgb srgb": [255, 0, 0, 204],
        "srgb display-p3": [234, 51, 35, 204],
        "display-p3 srgb": [255, 0, 0, 204],
        "display-p3 display-p3": [255, 0, 0, 204],
    },
    "Display-P3-BBBC00000000FFFF.png": {
        "srgb srgb": [205, 0, 0, 255],
        "srgb display-p3": [188, 39, 26, 255],
        "display-p3 srgb": [205, 0, 0, 255],
        "display-p3 display-p3": [187, 0, 0, 255],
    },
    "Display-P3-BBBC00000000CCCC.png": {
        "srgb srgb": [205, 0, 0, 204],
        "srgb display-p3": [188, 39, 26, 204],
        "display-p3 srgb": [205, 0, 0, 204],
        "display-p3 display-p3": [187, 0, 0, 204],
    },

    "Adobe-RGB-FFFF00000000FFFF.png": {
        "srgb srgb": [255, 0, 0, 255],
        "srgb display-p3": [234, 51, 35, 255],
        "display-p3 srgb": [255, 19, 11, 255],
        "display-p3 display-p3": [255, 61, 43, 255],
    },
    "Adobe-RGB-FFFF00000000CCCC.png": {
        "srgb srgb": [255, 0, 0, 204],
        "srgb display-p3": [234, 51, 35, 204],
        "display-p3 srgb": [255, 19, 11, 204],
        "display-p3 display-p3": [255, 61, 43, 204],
    },
    "Adobe-RGB-BBBC00000000FFFF.png": {
        "srgb srgb": [219, 0, 0, 255],
        "srgb display-p3": [201, 42, 29, 255],
        "display-p3 srgb": [219, 0, 1, 255],
        "display-p3 display-p3": [201, 42, 29, 255],
    },
    "Adobe-RGB-BBBC00000000CCCC.png": {
        "srgb srgb": [219, 0, 0, 204],
        "srgb display-p3": [201, 42, 29, 204],
        "display-p3 srgb": [219, 0, 1, 204],
        "display-p3 display-p3": [201, 42, 29, 204],
    },
};

const svgImageTests = {
    // SVG source images

    "sRGB-FF0000.svg": {
        "srgb srgb": [255, 0, 0, 255],
        "srgb display-p3": [234, 51, 35, 255],
        "display-p3 srgb": [255, 0, 0, 255],
        "display-p3 display-p3": [234, 51, 35, 255],
    },
    "sRGB-BB0000.svg": {
        "srgb srgb": [187, 0, 0, 255],
        "srgb display-p3": [171, 35, 23, 255],
        "display-p3 srgb": [187, 1, 0, 255],
        "display-p3 display-p3": [171, 35, 23, 255],
    },

    "Display-P3-1-0-0.svg": {
        "srgb srgb": [255, 0, 0, 255],
        "srgb display-p3": [234, 51, 35, 255],
        "display-p3 srgb": [255, 0, 0, 255],
        "display-p3 display-p3": [255, 0, 0, 255],
    },
    "Display-P3-0.7333-0-0.svg": {
        "srgb srgb": [205, 0, 0, 255],
        "srgb display-p3": [188, 39, 26, 255],
        "display-p3 srgb": [205, 0, 0, 255],
        "display-p3 display-p3": [187, 0, 0, 255],
    },
};

// Each video:
//  * is 300x200 and has a single color
//  * has a filename base that indicates its contents:
//
//      <color-space>-<8-or-10-bit-color-value>
//
//  * was generated using commands like:
//
//      W=300 H=200 Y=3F Cb=66 Cr=F0 ; \
//        perl -e "print pack('c', 0x$Y) x ($W * $H), pack('c', 0x$Cb) x ($W * $H / 4), pack('c', 0x$Cr) x ($W * $H / 4)" | \
//        ffmpeg -f rawvideo -pix_fmt yuv420p -s:v ${W}x$H -r 25 -i - -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc iec61966_2_1 sRGB-FF0100.webm
//
//      W=300 H=200 Y=0BB Cb=1BD Cr=2EF ; \
//        perl -e "print pack('s', 0x$Y) x ($W * $H), pack('s', 0x$Cb) x ($W * $H / 4), pack('s', 0x$Cr) x ($W * $H / 4)" | \
//        ffmpeg -f rawvideo -pix_fmt yuv420p10le -s:v ${W}x$H -r 25 -i - -c:v libx265 -vtag hvc1 -pix_fmt yuv420p10le -colorspace bt2020nc -color_primaries bt2020 -color_trc bt2020-10 Rec2020-222000000.mp4
//
//      W=300 H=200 Y=0BB Cb=1BD Cr=2EF ; \
//        perl -e "print pack('s', 0x$Y) x ($W * $H), pack('s', 0x$Cb) x ($W * $H / 4), pack('s', 0x$Cr) x ($W * $H / 4)" | \
//        ffmpeg -f rawvideo -pix_fmt yuv420p10le -s:v ${W}x$H -r 25 -i - -vcodec libvpx-vp9 -profile:v 2 -pix_fmt yuv420p10le -colorspace bt2020nc -color_primaries bt2020 -color_trc bt2020-10 Rec2020-222000000.webm
//
//    where the Y'CbCr values were computed using https://jdashg.github.io/misc/colors/from-coeffs.html.
const videoTests = {
    // Rec.709 Y'CbCr (0x3F, 0x66, 0xF0) = sRGB (0xFF, 0x01, 0x00)
    "sRGB-FF0100": {
        "srgb srgb": [255, 1, 0, 255],
        "srgb display-p3": [234, 51, 35, 255],
        "display-p3 srgb": [255, 0, 0, 255],
        "display-p3 display-p3": [234, 51, 35, 255],
    },
    // Rec.709 Y'CbCr (0x32, 0x6D, 0xD2) = sRGB (0xBB, 0x00, 0x00)
    "sRGB-BB0000": {
        "srgb srgb": [187, 0, 0, 255],
        "srgb display-p3": [171, 35, 23, 255],
        "display-p3 srgb": [187, 1, 0, 255],
        "display-p3 display-p3": [171, 35, 23, 255],
    },

    // 10 bit Rec.2020 Y'CbCr (0x126, 0x183, 0x3C0) = Rec.2020 (0x3FF, 0x000, 0x000)
    "Rec2020-3FF000000": {
        "srgb srgb": [255, 0, 0, 255],
        "srgb display-p3": [234, 51, 35, 255],
        "display-p3 srgb": [255, 0, 0, 255],
        "display-p3 display-p3": [255, 0, 9, 255],
    },
    // 10 bit Rec.2020 Y'CbCr (0x0BB, 0x1BD, 0x2EF) = Rec.2020 (0x222, 0x000, 0x000)
    "Rec2020-222000000": {
        "srgb srgb": [186, 0, 0, 255],
        "srgb display-p3": [170, 34, 23, 255],
        "display-p3 srgb": [186, 0, 0, 255],
        "display-p3 display-p3": [169, 0, 3, 255],
    },
};

const fromSRGBToDisplayP3 = {
    "255,0,0,255": [234, 51, 35, 255],
    "255,0,0,204": [234, 51, 35, 204],
    "187,0,0,255": [171, 35, 23, 255],
    "187,0,0,204": [171, 35, 23, 204],
};

const fromDisplayP3ToSRGB = {
    "255,0,0,255": [255, 0, 0, 255],
    "255,0,0,204": [255, 0, 0, 204],
    "187,0,0,255": [205, 0, 0, 255],
    "187,0,0,204": [205, 0, 0, 204],
};

function pixelsApproximatelyEqual(p1, p2) {
    for (let i = 0; i < 4; ++i) {
        if (Math.abs(p1[i] - p2[i]) > 3)
            return false;
    }
    return true;
}
