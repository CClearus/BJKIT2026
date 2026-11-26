using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

// Tools > Board > Build Web (into website)
// Builds the board as WebGL straight into the camp website: BJKIT2026/public/game/
// and writes public/game/build.json, which public/index.html reads to load the game into #map-canvas.
//
// - No compression: the camp server (server.js) serves plain files, no Brotli/gzip headers needed.
// - File names are content hashes: the server lets browsers cache /game/Build/ forever, and a rebuild
//   gets new names, so nobody is stuck on an old build.
// - WebGL uses the "PC" quality level (the one with SSAO + heat haze), same look as the editor.
public static class WebBuild
{
    static string OutDir => Path.GetFullPath(Path.Combine(Application.dataPath, "../../../public/game"));

    // Same build, but tells the compiler to spend less time optimising (Unity's "Shorter Build Time" code
    // optimisation + "Faster (smaller) builds" for IL2CPP). Use it while trying things; the board runs a bit
    // slower, so do a normal Build Web before the camp.
    [MenuItem("Tools/Board/Build Web - fast test build")]
    public static void BuildFast() => Build(fast: true);

    [MenuItem("Tools/Board/Build Web (into website)")]
    public static void Build() => Build(fast: false);

    static void Build(bool fast)
    {
        if (!BuildPipeline.IsBuildTargetSupported(BuildTargetGroup.WebGL, BuildTarget.WebGL))
        {
            EditorUtility.DisplayDialog("Web build", "WebGL Build Support is not installed.\nUnity Hub > Installs > 6000.6.0f1 > Add modules > Web Build Support, then restart Unity.", "OK");
            return;
        }

        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
        PlayerSettings.WebGL.decompressionFallback = false;
        PlayerSettings.WebGL.nameFilesAsHashes = true;
        PlayerSettings.WebGL.dataCaching = false;   // the browser's HTTP cache does this job
        UsePcQualityForWebGL();
        UseGraphicsApis();
        SetCodeOptimization(fast ? "BuildTimes" : "RuntimeSpeed");
        PlayerSettings.SetIl2CppCodeGeneration(UnityEditor.Build.NamedBuildTarget.WebGL,
            fast ? UnityEditor.Build.Il2CppCodeGeneration.OptimizeSize : UnityEditor.Build.Il2CppCodeGeneration.OptimizeSpeed);
        Debug.Log($"[Web build] Starting {(fast ? "FAST test" : "normal")} build...");

        // old build out (hash names would otherwise pile up)
        string buildDir = Path.Combine(OutDir, "Build");
        if (Directory.Exists(buildDir)) Directory.Delete(buildDir, true);
        Directory.CreateDirectory(OutDir);

        var scenes = EditorBuildSettings.scenes.Where(s => s.enabled).Select(s => s.path).ToArray();
        BuildReport report;
        var restore = UseWebRenderAssets();   // lighter copies of the PC render settings, for this build only
        try
        {
            report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = scenes,
                locationPathName = OutDir,
                target = BuildTarget.WebGL,
                targetGroup = BuildTargetGroup.WebGL,
                options = BuildOptions.None,
            });
        }
        finally { restore?.Invoke(); }

        if (report.summary.result != BuildResult.Succeeded)
        {
            Debug.LogError($"[Web build] Failed: {report.summary.result}, {report.summary.totalErrors} errors.");
            return;
        }

        WriteManifest();
        Debug.Log($"[Web build] Done: {OutDir} ({report.summary.totalSize / (1024f * 1024f):F1} MB, {report.summary.totalTime.TotalMinutes:F1} min)");
    }

    // Reads the file names Unity wrote into its own index.html and saves them as build.json for our page.
    static void WriteManifest()
    {
        string html = File.ReadAllText(Path.Combine(OutDir, "index.html"));
        string Find(string key)
        {
            var m = Regex.Match(html, key + @"\s*[:=]\s*buildUrl\s*\+\s*""/([^""]+)""");
            return m.Success ? m.Groups[1].Value : "";
        }
        var sb = new StringBuilder();
        sb.Append("{\n");
        sb.Append("  \"loader\": \"").Append(Find("loaderUrl")).Append("\",\n");
        sb.Append("  \"data\": \"").Append(Find("dataUrl")).Append("\",\n");
        sb.Append("  \"framework\": \"").Append(Find("frameworkUrl")).Append("\",\n");
        sb.Append("  \"code\": \"").Append(Find("codeUrl")).Append("\",\n");
        sb.Append("  \"productName\": \"").Append(PlayerSettings.productName).Append("\",\n");
        sb.Append("  \"productVersion\": \"").Append(PlayerSettings.bundleVersion).Append("\",\n");
        sb.Append("  \"builtAt\": \"").Append(System.DateTime.Now.ToString("s")).Append("\"\n");
        sb.Append("}\n");
        File.WriteAllText(Path.Combine(OutDir, "build.json"), sb.ToString());
    }

    // ---------- graphics API ----------
    // WebGPU first, WebGL2 as the fallback (the player picks the first one the browser supports).
    // In Chrome/Edge on Windows, WebGPU runs on Direct3D 12 with much less CPU work per draw call than
    // WebGL2 (which goes through ANGLE to Direct3D 11). Unity shares the page's one thread, so less CPU per
    // frame = smoother page. Browsers without WebGPU get the WebGL2 version of the same build.
    // If the WebGPU board misbehaves, set this to false and rebuild (WebGL2 only, as before).
    const bool UseWebGPU = true;

    static void UseGraphicsApis()
    {
        var apis = UseWebGPU
            ? new[] { UnityEngine.Rendering.GraphicsDeviceType.WebGPU, UnityEngine.Rendering.GraphicsDeviceType.OpenGLES3 }
            : new[] { UnityEngine.Rendering.GraphicsDeviceType.OpenGLES3 };
        PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.WebGL, false);
        PlayerSettings.SetGraphicsAPIs(BuildTarget.WebGL, apis);
        Debug.Log("[Web build] Graphics APIs: " + string.Join(", ", PlayerSettings.GetGraphicsAPIs(BuildTarget.WebGL)));
    }

    // ---------- lighter rendering for the web board ----------
    // In the browser, Unity shares the page's GPU (and thread), so the full editor-quality renderer made the
    // whole page lag at 100% resolution. For each web build, copies of the PC render settings are made with
    // the expensive parts swapped for cheaper ones that look almost the same from the 45° camera ~90 m away,
    // put on the PC quality level just for the build, then the original goes back (the editor never changes).
    //   Renderer (Web_Renderer):  heat haze OFF (it blurred the whole board on the web);
    //                             Forward instead of Forward+ (one sun, no extra lights: Forward+ only costs);
    //                             SSAO at half resolution, from depth (no extra depth-normals pass that draws
    //                             the whole scene again), medium blur instead of high.
    //   Asset (Web_RPAsset):      2 shadow cascades instead of 4 (each still 2048 px; split at 110 m so the
    //                             board stays in the sharp one), medium soft shadows instead of high, no opaque
    //                             texture copy (nothing reads it).
    //                             Alpha Processing on + 64-bit HDR: keeps the see-through sky
    //                             (Scripts/Board/BoardWebPerformance.cs) through post-processing.
    // To change a setting for the web only, change it here; to change the look everywhere, edit PC_RPAsset /
    // PC_Renderer as usual (the web copies are remade from them on every build).
    const string WebRpPath = "Assets/Settings/Web_RPAsset.asset";
    const string WebRendererPath = "Assets/Settings/Web_Renderer.asset";

    static System.Action UseWebRenderAssets()
    {
        int pc = System.Array.IndexOf(QualitySettings.names, "PC");
        if (pc < 0) { Debug.LogWarning("[Web build] No 'PC' quality level: web build uses the full renderer."); return null; }
        var qsAsset = AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/QualitySettings.asset")[0];
        SerializedProperty Slot(SerializedObject so) =>
            so.FindProperty("m_QualitySettings").GetArrayElementAtIndex(pc).FindPropertyRelative("customRenderPipeline");

        var qs = new SerializedObject(qsAsset);
        var original = Slot(qs).objectReferenceValue;
        var pcRp = (original ?? UnityEngine.Rendering.GraphicsSettings.defaultRenderPipeline)
                   as UnityEngine.Rendering.Universal.UniversalRenderPipelineAsset;
        if (pcRp == null) { Debug.LogWarning("[Web build] PC quality level has no URP asset: web build uses the full renderer."); return null; }

        var web = MakeWebRenderAssets(pcRp);
        Slot(qs).objectReferenceValue = web;
        qs.ApplyModifiedPropertiesWithoutUndo();
        AssetDatabase.SaveAssets();
        Debug.Log("[Web build] Using the lighter web renderer (Web_RPAsset / Web_Renderer).");

        return () =>
        {
            var back = new SerializedObject(qsAsset);
            Slot(back).objectReferenceValue = original;
            back.ApplyModifiedPropertiesWithoutUndo();
            AssetDatabase.SaveAssets();
        };
    }

    static UnityEngine.Rendering.Universal.UniversalRenderPipelineAsset MakeWebRenderAssets(
        UnityEngine.Rendering.Universal.UniversalRenderPipelineAsset pc)
    {
        var pcRenderer = new SerializedObject(pc).FindProperty("m_RendererDataList").GetArrayElementAtIndex(0).objectReferenceValue;
        AssetDatabase.DeleteAsset(WebRpPath);
        AssetDatabase.DeleteAsset(WebRendererPath);
        if (!AssetDatabase.CopyAsset(AssetDatabase.GetAssetPath(pcRenderer), WebRendererPath) ||
            !AssetDatabase.CopyAsset(AssetDatabase.GetAssetPath(pc), WebRpPath))
            throw new System.Exception("[Web build] Could not copy the PC render assets.");

        var renderer = AssetDatabase.LoadAssetAtPath<UnityEngine.Rendering.Universal.ScriptableRendererData>(WebRendererPath);
        var r = new SerializedObject(renderer);
        SetInt(r, "m_RenderingMode", 0);   // Forward
        r.ApplyModifiedPropertiesWithoutUndo();
        foreach (var f in renderer.rendererFeatures)
        {
            if (f == null) continue;
            if (f.name == "Heat Haze")
            {
                // Off on the web: from the camera (~90 m) the whole board is past its 55 m start, so the
                // shimmer smeared every node and line ("blurry"), and it cost a full-screen pass.
                var h = new SerializedObject(f);
                SetBool(h, "m_Active", false);
                h.ApplyModifiedPropertiesWithoutUndo();
                continue;
            }
            if (f.GetType().Name != "ScreenSpaceAmbientOcclusion") continue;
            var s = new SerializedObject(f);
            SetBool(s, "m_Settings.Downsample", true);
            SetInt(s, "m_Settings.Source", 0);        // Depth (not DepthNormals)
            SetInt(s, "m_Settings.BlurQuality", 1);   // Medium (Gaussian)
            s.ApplyModifiedPropertiesWithoutUndo();
        }

        var rp = AssetDatabase.LoadAssetAtPath<UnityEngine.Rendering.Universal.UniversalRenderPipelineAsset>(WebRpPath);
        var a = new SerializedObject(rp);
        a.FindProperty("m_RendererDataList").GetArrayElementAtIndex(0).objectReferenceValue = renderer;
        SetInt(a, "m_ShadowCascadeCount", 2);
        SetFloat(a, "m_Cascade2Split", 0.55f);   // of the 200 m shadow distance: near cascade 0-110 m
        SetInt(a, "m_SoftShadowQuality", 2);     // Medium
        SetBool(a, "m_RequireOpaqueTexture", false);
        SetBool(a, "m_RequireDepthTexture", false);   // only the heat haze needed it; SSAO asks for its own depth
        SetBool(a, "m_AllowPostProcessAlphaOutput", true);
        SetInt(a, "m_HDRColorBufferPrecision", 1);   // 64 bits: a colour buffer with alpha
        a.ApplyModifiedPropertiesWithoutUndo();
        EditorUtility.SetDirty(renderer);
        EditorUtility.SetDirty(rp);
        AssetDatabase.SaveAssets();
        return rp;
    }

    static void SetInt(SerializedObject so, string name, int v)
    {
        var p = so.FindProperty(name);
        if (p == null) Debug.LogWarning($"[Web build] Setting not found: {name}"); else p.intValue = v;
    }
    static void SetBool(SerializedObject so, string name, bool v)
    {
        var p = so.FindProperty(name);
        if (p == null) Debug.LogWarning($"[Web build] Setting not found: {name}"); else p.boolValue = v;
    }
    static void SetFloat(SerializedObject so, string name, float v)
    {
        var p = so.FindProperty(name);
        if (p == null) Debug.LogWarning($"[Web build] Setting not found: {name}"); else p.floatValue = v;
    }

    // Web "Code Optimization" (Build Settings > Web): BuildTimes, RuntimeSpeed, RuntimeSpeedLTO, DiskSize, DiskSizeLTO.
    // The API lives in the Web module's editor assembly, so it is reached by reflection (this project can't
    // reference it directly); falls back to the platform-settings key Unity stores it under.
    static void SetCodeOptimization(string value)
    {
        foreach (var asm in System.AppDomain.CurrentDomain.GetAssemblies())
        {
            var t = asm.GetType("UnityEditor.WebGL.UserBuildSettings");
            var p = t?.GetProperty("codeOptimization", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
            if (p == null || !p.CanWrite) continue;
            try
            {
                p.SetValue(null, System.Enum.Parse(p.PropertyType, value));
                return;
            }
            catch (System.Exception e) { Debug.LogWarning("[Web build] codeOptimization: " + e.Message); }
        }
        EditorUserBuildSettings.SetPlatformSettings(BuildPipeline.GetBuildTargetName(BuildTarget.WebGL), "CodeOptimization", value);
    }

    static void UsePcQualityForWebGL()
    {
        int pc = System.Array.IndexOf(QualitySettings.names, "PC");
        if (pc < 0) return;
        var asset = AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/QualitySettings.asset")[0];
        var so = new SerializedObject(asset);
        var list = so.FindProperty("m_PerPlatformDefaultQuality");
        for (int i = 0; i < list.arraySize; i++)
        {
            var e = list.GetArrayElementAtIndex(i);
            if (e.FindPropertyRelative("first").stringValue == "WebGL") e.FindPropertyRelative("second").intValue = pc;
        }
        so.ApplyModifiedProperties();
    }
}
