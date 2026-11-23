using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

// Keeps the skybox (HDRI) for ambient lighting + reflections,
// but makes cameras render a solid black background.
[InitializeOnLoad]
public static class HdriBlackBackground
{
    const string AppliedKey = "HdriBlackBackground_Applied";

    static HdriBlackBackground()
    {
        // Auto-apply once, the first time this script compiles.
        if (!EditorPrefs.GetBool(AppliedKey, false))
            EditorApplication.delayCall += () =>
            {
                EditorPrefs.SetBool(AppliedKey, true);
                Apply();
            };
    }

    [MenuItem("Tools/Lighting/HDRI Lighting + Black Background")]
    public static void Apply()
    {
        // 1. Lighting from the skybox material (your HDRI).
        RenderSettings.ambientMode = AmbientMode.Skybox;
        RenderSettings.defaultReflectionMode = DefaultReflectionMode.Skybox;
        DynamicGI.UpdateEnvironment();

        // 2. Cameras draw solid black instead of the sky.
        int count = 0;
        foreach (var cam in Object.FindObjectsByType<Camera>(FindObjectsInactive.Include, FindObjectsSortMode.None))
        {
            Undo.RecordObject(cam, "HDRI Black Background");
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = Color.black;
            EditorUtility.SetDirty(cam);
            count++;
        }

        // 3. Hide the sky in Scene views as well.
        foreach (SceneView sv in SceneView.sceneViews)
        {
            sv.sceneViewState.showSkybox = false;
            sv.Repaint();
        }

        EditorSceneManager.MarkAllScenesDirty();
        Debug.Log($"[HDRI] Lighting = Skybox, background = black on {count} camera(s). Save the scene (Ctrl+S) to keep it.");
    }
}
