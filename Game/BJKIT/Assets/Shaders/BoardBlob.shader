// Soft round shadow under each board node (a flat quad): lifts the tokens off the sand so they read as a
// layer on top. Transparent, no fog, drawn before the node itself covers its middle.
Shader "BJKIT/BoardBlob"
{
    Properties
    {
        _BaseColor ("Shadow colour (alpha = strength)", Color) = (0.12, 0.08, 0.05, 0.35)
        _Softness ("Softness (edge fade)", Range(0.01, 1)) = 0.55
    }

    SubShader
    {
        Tags { "RenderPipeline" = "UniversalPipeline" "RenderType" = "Transparent" "Queue" = "Transparent-100" }

        Pass
        {
            Name "BoardBlob"
            Tags { "LightMode" = "UniversalForward" }
            Blend SrcAlpha OneMinusSrcAlpha, One OneMinusSrcAlpha   // keeps the canvas alpha at 1 over ground
            ZWrite Off
            ZTest LEqual
            Cull Off
            Offset -1, -1

            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _BaseColor;
                half _Softness;
            CBUFFER_END

            struct Attributes { float4 positionOS : POSITION; float2 uv : TEXCOORD0; };
            struct Varyings { float4 positionCS : SV_POSITION; float2 uv : TEXCOORD0; };

            Varyings Vert(Attributes i)
            {
                Varyings o;
                o.positionCS = TransformObjectToHClip(i.positionOS.xyz);
                o.uv = i.uv;
                return o;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                half d = (half)(length(i.uv - 0.5) * 2.0);   // 0 centre .. 1 edge
                half a = _BaseColor.a * (1.0h - smoothstep(1.0h - _Softness, 1.0h, d));
                return half4(_BaseColor.rgb, a);
            }
            ENDHLSL
        }
    }
}
