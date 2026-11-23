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

    [MenuItem("Tools/Board/Build Web (into website)")]
    public static void Build()
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

        // old build out (hash names would otherwise pile up)
        string buildDir = Path.Combine(OutDir, "Build");
        if (Directory.Exists(buildDir)) Directory.Delete(buildDir, true);
        Directory.CreateDirectory(OutDir);

        var scenes = EditorBuildSettings.scenes.Where(s => s.enabled).Select(s => s.path).ToArray();
        var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
        {
            scenes = scenes,
            locationPathName = OutDir,
            target = BuildTarget.WebGL,
            targetGroup = BuildTargetGroup.WebGL,
            options = BuildOptions.None,
        });

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
