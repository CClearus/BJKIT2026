using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

// Warm "golden hour western" look:
// toned-down HDRI lighting, low warm sun, dusty fog, and a warm/contrasty color grade.
[InitializeOnLoad]
public static class CowboyLook
{
    // v4: real desert noon instead of a movie "yellow filter":
    //   white-hot hard sun + blue sky fill in the shadows + sandy ground bounce.
    //   The colour comes from the lighting contrast and the materials, not from a tint over everything.
    //   (v1 too red, v2 washed out, v3 monochrome yellow.)
    // v5: same look, brighter overall (v4 read too dark).
    const string AppliedKey = "CowboyLook_Applied_v5";
    const string ProfilePath = "Assets/Settings/CowboyProfile.asset";

    static CowboyLook()
    {
        if (!EditorPrefs.GetBool(AppliedKey, false))
            EditorApplication.delayCall += () =>
            {
                EditorPrefs.SetBool(AppliedKey, true);
                Apply();
            };
    }

    [MenuItem("Tools/Lighting/Apply Cowboy Look")]
    public static void Apply()
    {
        // ---------- Skybox / HDRI (lighting only, background stays black) ----------
        var sky = RenderSettings.skybox;
        if (sky != null)
        {
            Undo.RecordObject(sky, "Cowboy Look");
            if (sky.HasProperty("_Exposure")) sky.SetFloat("_Exposure", 1f);
            if (sky.HasProperty("_Tint")) sky.SetColor("_Tint", new Color(0.5f, 0.5f, 0.5f)); // neutral; only used for reflections now
            EditorUtility.SetDirty(sky);
        }

        // Ambient = what fills the shadows. Desert shadows are lit by the blue sky from above
        // and by warm light bouncing off the sand from below.
        RenderSettings.ambientMode = AmbientMode.Trilight;
        RenderSettings.ambientSkyColor = new Color(0.60f, 0.72f, 0.92f);     // blue sky fill (bright desert sky)
        RenderSettings.ambientEquatorColor = new Color(0.68f, 0.68f, 0.66f); // horizon
        RenderSettings.ambientGroundColor = new Color(0.64f, 0.52f, 0.38f);  // sand bounce (sand reflects a lot)
        RenderSettings.ambientIntensity = 1f;
        RenderSettings.defaultReflectionMode = DefaultReflectionMode.Skybox;
        RenderSettings.reflectionIntensity = 0.5f;

        // Dusty desert haze
        RenderSettings.fog = true;
        RenderSettings.fogMode = FogMode.ExponentialSquared;
        RenderSettings.fogColor = new Color(0.66f, 0.70f, 0.76f); // pale blue heat haze (distance goes cooler, not yellower)
        RenderSettings.fogDensity = 0.003f;

        // ---------- Sun: low, warm, golden hour ----------
        Light sun = RenderSettings.sun;
        if (sun == null)
            foreach (var l in Object.FindObjectsByType<Light>())
                if (l.type == LightType.Directional) { sun = l; break; }

        if (sun != null)
        {
            Undo.RecordObject(sun, "Cowboy Look");
            Undo.RecordObject(sun.transform, "Cowboy Look");
            sun.color = new Color(1f, 0.95f, 0.86f); // almost white, just a hint of warmth
            sun.intensity = 2.7f;
            sun.shadows = LightShadows.Soft;
            sun.shadowStrength = 0.75f;                                // crisp shadows, but sky fill still reads in them
            sun.transform.rotation = Quaternion.Euler(48f, -35f, 0f);  // high sun = harsh "noon showdown" light
            RenderSettings.sun = sun;
            EditorUtility.SetDirty(sun);
        }

        // ---------- Cameras: blue desert sky (DesertSky.mat via Skybox component) + post processing on ----------
        // RenderSettings.skybox (HDRI) stays as-is for reflections; only the camera background uses DesertSky.
        var desertSky = AssetDatabase.LoadAssetAtPath<Material>("Assets/Skyblokc/DesertSky.mat");
        foreach (var cam in Object.FindObjectsByType<Camera>(FindObjectsInactive.Include))
        {
            Undo.RecordObject(cam, "Cowboy Look");
            if (desertSky != null)
            {
                cam.clearFlags = CameraClearFlags.Skybox;
                var skyComp = cam.GetComponent<Skybox>();
                if (skyComp == null) skyComp = Undo.AddComponent<Skybox>(cam.gameObject);
                skyComp.material = desertSky;
            }
            var data = cam.GetUniversalAdditionalCameraData();
            if (data != null)
            {
                Undo.RecordObject(data, "Cowboy Look");
                data.renderPostProcessing = true;
                EditorUtility.SetDirty(data);
            }
            EditorUtility.SetDirty(cam);
        }

        // ---------- Post processing profile ----------
        var profile = AssetDatabase.LoadAssetAtPath<VolumeProfile>(ProfilePath);
        if (profile == null)
        {
            profile = ScriptableObject.CreateInstance<VolumeProfile>();
            AssetDatabase.CreateAsset(profile, ProfilePath);
        }

        var tone = Get<Tonemapping>(profile);
        tone.mode.Override(TonemappingMode.Neutral); // ACES pushed the oranges into deep red

        // Grade stays almost neutral: the warm-sun / blue-shadow contrast does the work.
        var ca = Get<ColorAdjustments>(profile);
        ca.postExposure.Override(0.45f);
        ca.contrast.Override(10f); // high contrast was crushing the shadows dark
        ca.saturation.Override(14f);
        ca.colorFilter.Override(Color.white);

        var wb = Get<WhiteBalance>(profile);
        wb.temperature.Override(5f);
        wb.tint.Override(0f);

        // No global tints: these turned the whole frame one colour.
        Get<SplitToning>(profile).active = false;
        Get<ShadowsMidtonesHighlights>(profile).active = false;

        // Bloom only on genuinely bright spots (sun-hit highlights), not on the whole ground.
        var bloom = Get<Bloom>(profile);
        bloom.intensity.Override(0.4f);
        bloom.threshold.Override(1.5f); // raised with the brighter sun so the ground doesn't glow
        bloom.scatter.Override(0.65f);
        bloom.tint.Override(new Color(1f, 0.96f, 0.9f));

        var vig = Get<Vignette>(profile);
        vig.intensity.Override(0.15f);
        vig.smoothness.Override(0.5f);
        vig.color.Override(Color.black);

        var grain = Get<FilmGrain>(profile);
        grain.type.Override(FilmGrainLookup.Thin1);
        grain.intensity.Override(0.1f);

        // Depth of field OFF: the camera sits ~90 m from the playfield, where a real lens
        // shows no blur, and blurring the play area just hides gameplay.
        // (The Default Volume Profile had a broken Gaussian range that blurred everything.)
        var dof = Get<DepthOfField>(profile);
        dof.mode.Override(DepthOfFieldMode.Off);

        EditorUtility.SetDirty(profile);
        AssetDatabase.SaveAssets();

        // Assign to the global volume (create one if missing)
        Volume vol = null;
        foreach (var v in Object.FindObjectsByType<Volume>())
            if (v.isGlobal) { vol = v; break; }
        if (vol == null)
        {
            var go = new GameObject("Global Volume");
            Undo.RegisterCreatedObjectUndo(go, "Cowboy Look");
            vol = go.AddComponent<Volume>();
            vol.isGlobal = true;
        }
        Undo.RecordObject(vol, "Cowboy Look");
        vol.sharedProfile = profile;
        vol.weight = 1f;
        vol.priority = 10f;
        EditorUtility.SetDirty(vol);

        DynamicGI.UpdateEnvironment();
        foreach (SceneView sv in SceneView.sceneViews) { sv.sceneViewState.showSkybox = true; sv.Repaint(); }
        EditorSceneManager.MarkAllScenesDirty();
        Debug.Log("[Cowboy Look] Applied. Press Ctrl+S to save the scene.");
    }

    static T Get<T>(VolumeProfile p) where T : VolumeComponent
    {
        if (!p.TryGet(out T c))
        {
            c = p.Add<T>(true);
            c.name = typeof(T).Name;
            AssetDatabase.AddObjectToAsset(c, p);
        }
        c.active = true;
        return c;
    }
}
