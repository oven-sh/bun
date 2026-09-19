#ifdef __cplusplus
#define FT_STATIC_BYTE_CAST( type, var )                         \
          static_cast<type>( static_cast<unsigned char>( var ) )
#else
#define FT_STATIC_BYTE_CAST( type, var )  (type)(unsigned char)(var)
#endif

#ifndef FT_IMAGE_TAG

#define FT_IMAGE_TAG( value, _x1, _x2, _x3, _x4 )                         \
          value = ( ( FT_STATIC_BYTE_CAST( unsigned long, _x1 ) << 24 ) | \
                    ( FT_STATIC_BYTE_CAST( unsigned long, _x2 ) << 16 ) | \
                    ( FT_STATIC_BYTE_CAST( unsigned long, _x3 ) << 8  ) | \
                      FT_STATIC_BYTE_CAST( unsigned long, _x4 )         )

#endif /* FT_IMAGE_TAG */

typedef enum  FT_Glyph_Format_
{
    FT_IMAGE_TAG( FT_GLYPH_FORMAT_NONE, 0, 0, 0, 0 ),

    FT_IMAGE_TAG( FT_GLYPH_FORMAT_COMPOSITE, 'c', 'o', 'm', 'p' ),
    FT_IMAGE_TAG( FT_GLYPH_FORMAT_BITMAP,    'b', 'i', 't', 's' ),
    FT_IMAGE_TAG( FT_GLYPH_FORMAT_OUTLINE,   'o', 'u', 't', 'l' ),
    FT_IMAGE_TAG( FT_GLYPH_FORMAT_PLOTTER,   'p', 'l', 'o', 't' ),
    FT_IMAGE_TAG( FT_GLYPH_FORMAT_SVG,       'S', 'V', 'G', ' ' )

} FT_Glyph_Format;

int
main(void)
{
	return 0;
}
