// Board node tokens in a party-board-game style: chunky plastic pieces with a raised rim and a coloured
// centre. Stylised lighting from the sun's direction only (soft wrap-around shading + a glossy highlight +
// a light edge), but no shadows, fog or SSAO, so the tokens always read clearly as a layer on top of the
// world. The token mesh (Board.TokenMesh) has vertex colour red = 1 on the centre disc: the centre gets
// Colour, everything else gets Rim. Meshes without vertex colours just use Rim (set Rim = Colour then).
Shader "BJKIT/BoardToken"
{
    Properties
    {
        _BaseColor ("Colour (centre)", Color) = (0.18, 0.49, 0.96, 1)
        _RimColor ("Rim (raised ring and sides)", Color) = (1, 1, 1, 1)
        [HDR] _EmissionColor ("Glow on the centre (above ~1.5 it blooms)", Color) = (0, 0, 0, 1)
        _Ambient ("Shadow side brightness", Range(0, 1)) = 0.62
        _Gloss ("Gloss (plastic highlight)", Range(0, 1)) = 0.55
        _EdgeLight ("Light edge", Range(0, 1)) = 0.25
        [Enum(UnityEngine.Rendering.CullMode)] _Cull ("Cull", Float) = 0
    }

    SubShader
    {
        Tags { "RenderPipeline" = "UniversalPipeline" "RenderType" = "Opaque" "Queue" = "Geometry+20" }

        Pass
        {
            Name "BoardToken"
            Tags { "LightMode" = "UniversalForward" }
            Cull [_Cull]
            ZWrite On
            ZTest LEqual

            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _BaseColor;
                half4 _RimColor;
                half4 _EmissionColor;
                half _Ambient;
                half _Gloss;
                half _EdgeLight;
                float _Cull;
            CBUFFER_END

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; half4 color : COLOR; };
            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                half3 normalWS : TEXCOORD1;
                half centre : TEXCOORD2;
            };

            Varyings Vert(Attributes i)
            {
                Varyings o;
                o.positionWS = TransformObjectToWorld(i.positionOS.xyz);
                o.positionCS = TransformWorldToHClip(o.positionWS);
                o.normalWS = (half3)TransformObjectToWorldNormal(i.normalOS);
                o.centre = i.color.r;
                return o;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                half3 n = normalize(i.normalWS);
                half3 l = (half3)GetMainLight().direction;   // direction only: the palette stays exact
                half3 v = (half3)GetWorldSpaceNormalizeViewDir(i.positionWS);

                half3 albedo = lerp(_RimColor.rgb, _BaseColor.rgb, i.centre);
                half wrap = saturate(dot(n, l) * 0.5h + 0.5h);                 // soft, never black
                half3 col = albedo * lerp(_Ambient, 1.0h, wrap);

                half3 h = normalize(l + v);
                half spec = pow(saturate(dot(n, h)), exp2(lerp(4.0h, 9.0h, _Gloss))) * _Gloss;
                col += spec * 0.5h;
                col += pow(1.0h - saturate(dot(n, v)), 4.0h) * _EdgeLight;   // light edge, like a lit plastic rim
                col += _EmissionColor.rgb * i.centre;
                return half4(col, 1.0h);
            }
            ENDHLSL
        }
    }
}
