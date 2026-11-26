// Board paths: a glowing line painted on the sand. Drawn on a flat ribbon that hugs the terrain
// (Board.BuildEdges, LineRenderer in Tile mode): V runs across the ribbon (0..1), U along it in ribbon widths.
// Across: a bright core with crisp edges, then a soft glow that fades out to both sides.
// Along: an optional slow shimmer drifting along the path so it feels alive.
// The core colour is HDR: above the bloom threshold (~1.5) it gets a slight real glow too.
Shader "BJKIT/BoardPath"
{
    Properties
    {
        [HDR] _CoreColor ("Core colour (HDR)", Color) = (1.7, 1.75, 1.6, 1)
        _GlowColor ("Glow colour (alpha = glow strength)", Color) = (0.45, 1, 0.4, 0.55)
        _CoreWidth ("Core width (share of the ribbon)", Range(0.05, 0.9)) = 0.3
        _GlowFalloff ("Glow falloff (higher = tighter)", Range(0.5, 6)) = 2
        _FlowStrength ("Shimmer strength", Range(0, 1)) = 0.15
        _FlowSpeed ("Shimmer speed", Float) = 0.6
        _FlowLength ("Shimmer length (ribbon widths)", Float) = 5
    }

    SubShader
    {
        Tags { "RenderPipeline" = "UniversalPipeline" "RenderType" = "Transparent" "Queue" = "Transparent-110" }

        Pass
        {
            Name "BoardPath"
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
                half4 _CoreColor;
                half4 _GlowColor;
                half _CoreWidth;
                half _GlowFalloff;
                half _FlowStrength;
                float _FlowSpeed;
                float _FlowLength;
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
                half d = (half)abs(i.uv.y - 0.5) * 2.0h;   // 0 = middle of the path, 1 = ribbon edge
                half aa = max(fwidth(d), 0.001h);
                half core = 1.0h - smoothstep(_CoreWidth - aa, _CoreWidth + aa, d);
                half glow = pow(saturate(1.0h - d), _GlowFalloff) * _GlowColor.a;

                float t = fmod(_Time.y, 1000.0) * _FlowSpeed;
                half flow = 1.0h + _FlowStrength * (half)sin((i.uv.x - t) * 6.2831853 / max(_FlowLength, 0.01));

                half3 rgb = lerp(_GlowColor.rgb, _CoreColor.rgb, core) * flow;
                half a = saturate(max(core, glow));
                return half4(rgb, a);
            }
            ENDHLSL
        }
    }
}
