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
    const string AppliedKey = "CowboyLook_Applied_v1";
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
            if (sky.HasProperty("_Exposure")) sky.SetFloat("_Exposure", 0.75f);
            if (sky.HasProperty("_Tint")) sky.SetColor("_Tint", new Color(0.62f, 0.52f, 0.42f)); // warm/dusty
            EditorUtility.SetDirty(sky);
        }

        RenderSettings.ambientMode = AmbientMode.Skybox;
        RenderSettings.ambientIntensity = 0.7f;
        RenderSettings.defaultReflectionMode = DefaultReflectionMode.Skybox;
        RenderSettings.reflectionIntensity = 0.5f;

        // Dusty desert haze
        RenderSettings.fog = true;
        RenderSettings.fogMode = FogMode.ExponentialSquared;
        RenderSettings.fogColor = new Color(0.36f, 0.24f, 0.15f);
        RenderSettings.fogDensity = 0.008f;

        // ---------- Sun: low, warm, golden hour ----------
        Light sun = RenderSettings.sun;
        if (sun == null)
            foreach (var l in Object.FindObjectsByType<Light>(FindObjectsSortMode.None))
                if (l.type == LightType.Directional) { sun = l; break; }

        if (sun != null)
        {
            Undo.RecordObject(sun, "Cowboy Look");
            Undo.RecordObject(sun.transform, "Cowboy Look");
            sun.color = new Color(1f, 0.72f, 0.45f);
            sun.intensity = 1.3f;
            sun.shadows = LightShadows.Soft;
            sun.shadowStrength = 0.85f;
            sun.transform.rotation = Quaternion.Euler(22f, -35f, 0f); // low angle = long shadows
            RenderSettings.sun = sun;
            EditorUtility.SetDirty(sun);
        }

        // ---------- Cameras: black bg + post processing on ----------
        foreach (var cam in Object.FindObjectsByType<Camera>(FindObjectsInactive.Include, FindObjectsSortMode.None))
        {
            Undo.RecordObject(cam, "Cowboy Look");
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = Color.black;
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
        tone.mode.Override(TonemappingMode.ACES);

        var ca = Get<ColorAdjustments>(profile);
        ca.postExposure.Override(-0.35f);
        ca.contrast.Override(18f);
        ca.saturation.Override(-12f);
        ca.colorFilter.Override(new Color(1f, 0.9f, 0.78f));

        var wb = Get<WhiteBalance>(profile);
        wb.temperature.Override(28f);
        wb.tint.Override(6f);

        var split = Get<SplitToning>(profile);
        split.shadows.Override(new Color(0.42f, 0.30f, 0.22f));   // brown shadows
        split.highlights.Override(new Color(1f, 0.78f, 0.52f));   // golden highlights
        split.balance.Override(-15f);

        var smh = Get<ShadowsMidtonesHighlights>(profile);
        smh.shadows.Override(new Vector4(1f, 0.93f, 0.85f, -0.05f));
        smh.highlights.Override(new Vector4(1f, 0.95f, 0.85f, -0.08f));

        var bloom = Get<Bloom>(profile);
        bloom.intensity.Override(0.35f);
        bloom.threshold.Override(1.1f);
        bloom.tint.Override(new Color(1f, 0.8f, 0.6f));

        var vig = Get<Vignette>(profile);
        vig.intensity.Override(0.32f);
        vig.smoothness.Override(0.45f);
        vig.color.Override(new Color(0.12f, 0.06f, 0.02f));

        var grain = Get<FilmGrain>(profile);
        grain.type.Override(FilmGrainLookup.Thin1);
        grain.intensity.Override(0.2f);

        EditorUtility.SetDirty(profile);
        AssetDatabase.SaveAssets();

        // Assign to the global volume (create one if missing)
        Volume vol = null;
        foreach (var v in Object.FindObjectsByType<Volume>(FindObjectsSortMode.None))
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
        foreach (SceneView sv in SceneView.sceneViews) { sv.sceneViewState.showSkybox = false; sv.Repaint(); }
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
