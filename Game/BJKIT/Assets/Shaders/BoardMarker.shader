// Board nodes and path lines drawn like a clean layer on top of the world (board-game look):
// flat colour, no sun shading, no shadows, no fog, no SSAO, so they keep their exact colour at any
// distance. Sides of a disc are a little darker than the top so it still reads as a raised token.
// Used by the materials in Assets/Board/Materials (Tools > Board > Rebuild Visuals sets them up).
Shader "BJKIT/BoardMarker"
{
    Properties
    {
        _BaseColor ("Colour", Color) = (1, 1, 1, 1)
        [HDR] _EmissionColor ("Glow (adds on top; above ~1.5 it blooms)", Color) = (0, 0, 0, 1)
        _SideShade ("Side darkening", Range(0, 1)) = 0.3
        [Enum(UnityEngine.Rendering.CullMode)] _Cull ("Cull", Float) = 2
        _OffsetUnits ("Depth offset (more negative = drawn on top of touching parts)", Float) = 0
    }

    SubShader
    {
        Tags { "RenderPipeline" = "UniversalPipeline" "RenderType" = "Opaque" "Queue" = "Geometry+20" }

        Pass
        {
            Name "BoardMarker"
            Tags { "LightMode" = "UniversalForward" }
            Cull [_Cull]
            ZWrite On
            ZTest LEqual
            Offset -1, [_OffsetUnits]

            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _BaseColor;
                half4 _EmissionColor;
                half _SideShade;
                float _Cull;
                float _OffsetUnits;
            CBUFFER_END

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; };
            struct Varyings { float4 positionCS : SV_POSITION; half up : TEXCOORD0; };

            Varyings Vert(Attributes i)
            {
                Varyings o;
                o.positionCS = TransformObjectToHClip(i.positionOS.xyz);
                o.up = (half)abs(TransformObjectToWorldNormal(i.normalOS).y);   // 1 = top face, 0 = side
                return o;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                half shade = lerp(1.0h - _SideShade, 1.0h, i.up);
                return half4(_BaseColor.rgb * shade + _EmissionColor.rgb, 1.0h);
            }
            ENDHLSL
        }
    }
}
