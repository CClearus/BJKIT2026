// Desert heat shimmer for URP (used by a Full Screen Pass Renderer Feature on PC_Renderer).
// Smooth value noise drifting upward (hot air rising), stretched horizontally.
// Only distorts pixels farther than _StartDistance; the sky / far plane is untouched.
Shader "Hidden/BJKIT/HeatHaze"
{
    Properties
    {
        _Strength ("Strength (UV offset)", Range(0, 0.01)) = 0.003
        _Speed ("Rise Speed", Float) = 0.8
        _Scale ("Noise Scale (cells per screen height)", Float) = 30
        _StartDistance ("Start Distance (m)", Float) = 55
        _EndDistance ("Full Strength Distance (m)", Float) = 125
    }

    SubShader
    {
        Tags { "RenderPipeline" = "UniversalPipeline" }
        ZWrite Off ZTest Always Cull Off Blend Off

        Pass
        {
            Name "HeatHaze"

            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.core/Runtime/Utilities/Blit.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareDepthTexture.hlsl"

            float _Strength;
            float _Speed;
            float _Scale;
            float _StartDistance;
            float _EndDistance;

            float Hash(float2 p)
            {
                p = frac(p * float2(123.34, 456.21));
                p += dot(p, p + 45.32);
                return frac(p.x * p.y);
            }

            // Value noise with quintic interpolation -> continuous, smooth motion. Returns -1..1.
            float Noise(float2 p)
            {
                float2 i = floor(p);
                float2 f = frac(p);
                float2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
                float a = Hash(i);
                float b = Hash(i + float2(1, 0));
                float c = Hash(i + float2(0, 1));
                float d = Hash(i + float2(1, 1));
                return lerp(lerp(a, b, u.x), lerp(c, d, u.x), u.y) * 2.0 - 1.0;
            }

            float HazeMask(float2 uv)
            {
                float rawDepth = SampleSceneDepth(uv);
                #if UNITY_REVERSED_Z
                    float isGeometry = step(0.000001, rawDepth);
                #else
                    float isGeometry = step(rawDepth, 0.999999);
                #endif
                float dist = LinearEyeDepth(rawDepth, _ZBufferParams);
                return smoothstep(_StartDistance, max(_EndDistance, _StartDistance + 0.001), dist) * isGeometry;
            }

            half4 Frag(Varyings input) : SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(input);
                float2 uv = input.texcoord;

                float mask = HazeMask(uv);
                if (mask <= 0.0)
                    return SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_LinearClamp, uv);

                // Wrap time so precision never degrades in long sessions (period is long enough to be invisible).
                float t = fmod(_Time.y, 1000.0) * _Speed;
                float aspect = _ScreenParams.x / _ScreenParams.y;

                // Horizontally stretched cells (heat ripples are wide and thin), scrolling upward.
                float2 p = float2(uv.x * aspect * 0.55, uv.y * 1.6) * _Scale;

                float2 offset;
                offset.x = Noise(p + float2(0.0, -t))
                         + Noise(p * 2.13 + float2(5.2, -t * 1.7)) * 0.5;
                offset.y = Noise(p * 1.31 + float2(17.1, -t * 1.25)) * 0.4;

                float2 distortedUV = uv + offset * (_Strength * mask);
                return SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_LinearClamp, distortedUV);
            }
            ENDHLSL
        }
    }
}
