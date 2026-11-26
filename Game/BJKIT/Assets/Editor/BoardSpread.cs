using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using BJKIT.BoardGame;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

// Tools > Board > Spread Board...   (also runnable from the Unity MCP: BoardSpread.RunAuto(1.5f))
// The board looked crowded: ~4 m tokens ~8 m apart on a 180 x 100 m terrain that didn't fill the screen.
// This spreads the whole layout out from the terrain centre by a factor and grows the terrain to fill the view:
//   - Nodes and props move outward but KEEP THEIR SIZE. Each prop moves by its own centre, exactly like the
//     nodes around it, so its place relative to the paths stays the same (nothing lands on a path).
//   - Pieces that belong together move as one rigid group:
//       * something resting ON another prop (mine cart on a mesa, a mesa's sand cap) rides with it;
//       * pieces of the same kind that touch stay joined (two overlapping mesas, a rail track, the skull's ribs);
//       * mine pieces (rails, carts, the mine entrance) that touch a mesa stay with that mesa.
//   - Background (cliff walls, the outer ground planes) is scaled up about the centre, so the wall still
//     surrounds the bigger board with no gaps.
//   - Terrain: a NEW TerrainData (the old one stays untouched = backup). Inside the old area the heightmap is
//     stretched by the same factor, so every hill stays under the same prop; outside it fades to flat sand.
//     Its size comes from what the camera sees (16:9), so it reaches the screen edges and runs under the cliffs.
//   - Shadow distance (URP assets), fog density and heat-haze distances scale with the new distances.
//   - Board.layoutScale is multiplied, so Build From Sketch later rebuilds at the same spread.
// Backups first: the scene is saved and copied to Assets/Backups/. Tools > Board > Undo Spread restores it.
public class BoardSpread : EditorWindow
{
    float spread = 1.5f;

    const float CompactSize = 30f;   // a group of objects narrower than this is one prop
    const float HugeSize = 100f;     // wider than this = background, scaled up with the layout
    static readonly Regex BackgroundName = new Regex("cliff|gliff|^plane|ground|backdrop", RegexOptions.IgnoreCase);

    [MenuItem("Tools/Board/Spread Board...")]
    static void Open()
    {
        var w = GetWindow<BoardSpread>(true, "Spread Board");
        w.minSize = new Vector2(460, 240);
    }

    void OnGUI()
    {
        EditorGUILayout.HelpBox(
            "Spreads the whole board out from the terrain centre so it is less crowded, and grows the terrain to fill the screen.\n\n" +
            "- Nodes and props move outward and keep their size; pieces that belong together (a mesa and what sits on it, " +
            "rail tracks, the skull and its ribs) move as one.\n" +
            "- Cliff walls / outer ground grow with the layout. Hills stay under their props.\n\n" +
            "The scene is saved and backed up to Assets/Backups first (Tools > Board > Undo Spread restores it).",
            MessageType.Info);
        spread = EditorGUILayout.Slider(new GUIContent("Spread (x)", "1.5 = 50% more room between everything"), spread, 1.05f, 3f);
        EditorGUILayout.Space();
        if (GUILayout.Button("Spread", GUILayout.Height(30)))
        {
            if (EditorUtility.DisplayDialog("Spread Board", $"Spread the board {spread:0.##}x?\n\nThe scene is saved and backed up to Assets/Backups first.", "Spread", "Cancel"))
                Debug.Log(RunAuto(spread));
            Close();
        }
    }

    // ------------------------------------------------------------------------------------------

    // Tools > Board > Undo Spread (restore backup): puts the newest Assets/Backups scene back over the open
    // scene, and undoes what Spread changed outside the scene (shadow distance, heat haze). Deletes the spread
    // terrain data (the backup scene uses the original terrain).
    [MenuItem("Tools/Board/Undo Spread (restore backup)")]
    static void UndoSpreadMenu()
    {
        var scene = EditorSceneManager.GetActiveScene();
        if (!EditorUtility.DisplayDialog("Undo Spread", $"Replace {scene.path} with its newest backup from Assets/Backups?\n\nChanges made after the spread are lost.", "Restore", "Cancel")) return;
        Debug.Log(UndoSpread());
    }

    public static string UndoSpread()
    {
        var scene = EditorSceneManager.GetActiveScene();
        var backups = AssetDatabase.FindAssets("t:Scene", new[] { "Assets/Backups" })
            .Select(AssetDatabase.GUIDToAssetPath)
            .Where(p => Path.GetFileName(p).StartsWith(scene.name + "_before_spread_"))
            .OrderByDescending(p => p).ToList();
        if (backups.Count == 0) return "[Spread Board] No backup of this scene in Assets/Backups.";
        string backup = backups[0];

        var board = Object.FindAnyObjectByType<Board>();
        float now = board && board.layoutScale > 0f ? board.layoutScale : 1f;
        var m = Regex.Match(File.ReadAllText(backup), @"layoutScale: ([0-9.]+)");
        float before = m.Success && float.TryParse(m.Groups[1].Value, System.Globalization.NumberStyles.Float,
            System.Globalization.CultureInfo.InvariantCulture, out var b) && b > 0f ? b : 1f;
        float k = now / before;
        var spreadTerrain = Terrain.activeTerrain ? AssetDatabase.GetAssetPath(Terrain.activeTerrain.terrainData) : "";

        string scenePath = scene.path;
        File.Copy(backup, scenePath, true);
        AssetDatabase.ImportAsset(scenePath, ImportAssetOptions.ForceUpdate);
        EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);

        var log = new StringBuilder();
        if (Mathf.Abs(k - 1f) > 0.001f) ScaleAssetDistances(1f / k, log);
        if (Path.GetFileName(spreadTerrain).StartsWith("Terrain spread")) AssetDatabase.DeleteAsset(spreadTerrain);
        AssetDatabase.SaveAssets();
        return $"[Spread Board] Restored {scenePath} from {backup} (asset distances / {k:0.##}).\n{log}";
    }

    // ------------------------------------------------------------------------------------------

    class Unit
    {
        public Transform t;
        public Bounds b;
        public string family;
        public float ground;   // terrain height under its centre
    }

    // "Hill1 (2)" -> mesa, "Rail (3)" -> mine, "Cartrigags (1)" -> skeleton, ...
    static string Family(string name)
    {
        string n = Regex.Replace(name, @"[\s.(][\s\S]*$", "").ToLowerInvariant();   // up to the first space/dot/bracket
        n = Regex.Replace(n, @"\d+$", "");
        if (n == "hill" || n == "sanded") return "mesa";
        if (n == "rail" || n == "minecart" || n == "cylinder") return "mine";
        if (n == "skull" || n == "cartrigags") return "skeleton";
        if (n == "cac" || n == "cas") return "cactus";
        return n;
    }

    public static string RunAuto(float k)
    {
        var terrain = Terrain.activeTerrain;
        var board = Object.FindAnyObjectByType<Board>();
        if (!terrain || !board) return "[Spread Board] Needs a Terrain and a Board in the open scene.";
        var scene = board.gameObject.scene;

        // ---- backups ----
        EditorSceneManager.SaveScene(scene);
        if (!AssetDatabase.IsValidFolder("Assets/Backups")) AssetDatabase.CreateFolder("Assets", "Backups");
        string stamp = System.DateTime.Now.ToString("yyyyMMdd_HHmmss");
        string sceneBackup = $"Assets/Backups/{scene.name}_before_spread_{stamp}.unity";
        AssetDatabase.CopyAsset(scene.path, sceneBackup);

        var log = new StringBuilder();
        var oldData = terrain.terrainData;
        Vector3 S = oldData.size, P0 = terrain.transform.position;
        var C = new Vector2(P0.x + S.x * 0.5f, P0.z + S.z * 0.5f);   // spread centre = terrain centre
        Vector3 Out(Vector3 p) => new Vector3(C.x + (p.x - C.x) * k, p.y, C.y + (p.z - C.y) * k);
        float Ground(Vector3 p) => terrain.SampleHeight(p) + P0.y;

        // ---- what to move (measured before anything changes) ----
        var skip = new HashSet<GameObject> { terrain.gameObject, board.gameObject };
        foreach (var c in Object.FindObjectsByType<Camera>()) skip.Add(c.gameObject);
        foreach (var l in Object.FindObjectsByType<Light>()) skip.Add(l.gameObject);
        foreach (var v in Object.FindObjectsByType<Volume>()) skip.Add(v.gameObject);
        var placeholders = GameObject.Find("Landmarks (placeholders)");
        if (placeholders) skip.Add(placeholders);

        var units = new List<Unit>();
        var background = new List<Transform>();
        foreach (var root in scene.GetRootGameObjects())
            if (!skip.Contains(root)) Collect(root.transform, skip, units, background);
        foreach (Transform c in terrain.transform) background.Add(c);   // the outer sand plane parented to the terrain
        foreach (var u in units) { u.family = Family(u.t.name); u.ground = Ground(u.b.center); }

        // ---- groups that move as one ----
        int n = units.Count;
        var parent = Enumerable.Range(0, n).ToArray();
        int Find(int i) { while (parent[i] != i) i = parent[i] = parent[parent[i]]; return i; }
        void Join(int i, int j, string why)
        {
            int a = Find(i), b2 = Find(j);
            if (a == b2) return;
            parent[a] = b2;
            log.AppendLine($"  join {units[i].t.name} + {units[j].t.name} ({why})");
        }
        for (int i = 0; i < n; i++)
        {
            var u = units[i];
            // resting on another prop: base clearly above the sand, and something under it reaches up to its base
            if (u.b.min.y > u.ground + 0.8f)
            {
                int best = -1; float bestTop = float.MinValue;
                for (int j = 0; j < n; j++)
                {
                    if (j == i) continue;
                    var w = units[j].b;
                    bool under = u.b.center.x > w.min.x && u.b.center.x < w.max.x && u.b.center.z > w.min.z && u.b.center.z < w.max.z;
                    if (under && w.max.y >= u.b.min.y - 1.5f && w.min.y < u.b.min.y && w.max.y > bestTop) { best = j; bestTop = w.max.y; }
                }
                if (best >= 0) Join(i, best, "sits on");
            }
            for (int j = i + 1; j < n; j++)
            {
                var v = units[j];
                // same kind and close together = one piece (mesa formations, rail tracks, the skull's ribcage,
                // a fence run). Buildings and cacti are spread like the nodes they stand between.
                if (u.family == v.family && u.family != "building" && u.family != "cactus" && Near(u.b, v.b, 4f)) Join(i, j, "same kind, close");
                else if (((u.family == "mine" && v.family == "mesa") || (u.family == "mesa" && v.family == "mine")) && Touch(u.b, v.b)) Join(i, j, "mine on mesa");
                else if ((u.family == "fence" || v.family == "fence") && Near(u.b, v.b, 1.5f)) Join(i, j, "fence end");
            }
        }
        var groups = Enumerable.Range(0, n).GroupBy(Find).Select(g => g.Select(i => units[i]).ToList()).ToList();

        // ---- move props: each group by its own footprint centre, like the nodes around it ----
        log.AppendLine("moved:");
        foreach (var g in groups)
        {
            var b = g[0].b;
            foreach (var u in g) b.Encapsulate(u.b);
            var delta = Out(b.center) - b.center;
            delta.y = 0f;   // the stretched terrain has the same height under the new centre
            foreach (var u in g) u.t.position += delta;
            log.AppendLine($"  {string.Join(" + ", g.Select(u => u.t.name))}");
        }

        // ---- background: scaled about the centre (a uniform scale of the whole backdrop) ----
        var bgWorld = background.Select(t => (t, pos: t.position)).ToList();
        log.AppendLine("background (scaled):");
        foreach (var (t, pos) in bgWorld)
        {
            t.position = Out(pos);
            t.localScale *= k;
            log.AppendLine($"  {t.name}");
        }

        // ---- placeholders and nodes ----
        if (placeholders)
            foreach (Transform ph in placeholders.transform)
            {
                ph.position = Out(ph.position);
                if (ph.name.StartsWith("PH River") && ph.TryGetComponent<BoxCollider>(out var bc))
                    bc.size = new Vector3(bc.size.x, bc.size.y, bc.size.z * k);
                EditorUtility.SetDirty(ph);
            }
        foreach (var node in board.Nodes) node.transform.position = Out(node.transform.position);
        board.layoutScale = (board.layoutScale > 0f ? board.layoutScale : 1f) * k;

        // ---- camera fits the spread board (16:9), then the terrain is sized to what it sees ----
        var fit = Object.FindAnyObjectByType<BoardCameraFit>();
        var cam = fit ? fit.GetComponent<Camera>() : Camera.main;
        if (fit) { fit.aimOffset *= k; fit.FitNow(16f / 9f); EditorUtility.SetDirty(fit); }
        Rect need = ViewFootprint(cam, 16f / 9f, P0.y, background, C, k, S, log);

        var data = BuildSpreadTerrain(terrain, k, C, need, log);
        Vector3 S2 = data.size;
        terrain.terrainData = data;
        var tc = terrain.GetComponent<TerrainCollider>();
        if (tc) tc.terrainData = data;
        terrain.transform.position = new Vector3(need.xMin, P0.y, need.yMin);
        foreach (var (t, pos) in bgWorld) if (t.IsChildOf(terrain.transform)) t.position = Out(pos);   // keep the plane where it was put
        EditorUtility.SetDirty(terrain);

        board.RebuildVisuals();
        EditorUtility.SetDirty(board);
        ScaleLookDistances(k, log);
        if (fit) fit.Refit();

        EditorSceneManager.MarkSceneDirty(scene);
        EditorSceneManager.SaveScene(scene);
        AssetDatabase.SaveAssets();
        return $"[Spread Board] Done: {k:0.##}x, terrain {S.x:0}x{S.z:0} m -> {S2.x:0}x{S2.z:0} m at ({need.xMin:0},{need.yMin:0}), " +
               $"{groups.Count} prop groups, {background.Count} background. Backup: {sceneBackup}\n{log}";
    }

    // A unit = an object with its own mesh, or a compact group of objects; spread-out groups (like the
    // imported fbx root holding every prop) are split into their children.
    static void Collect(Transform t, HashSet<GameObject> skip, List<Unit> units, List<Transform> background)
    {
        if (skip.Contains(t.gameObject)) return;
        var b = BoundsOf(t);
        if (b == null)
        {
            foreach (Transform c in t) Collect(c, skip, units, background);
            return;
        }
        float size = Mathf.Max(b.Value.size.x, b.Value.size.z);
        bool ownMesh = t.GetComponent<Renderer>();
        if (!ownMesh && size > CompactSize)
        {
            foreach (Transform c in t) Collect(c, skip, units, background);
            return;
        }
        if (BackgroundName.IsMatch(t.name) || size > HugeSize) background.Add(t);
        else units.Add(new Unit { t = t, b = b.Value });
    }

    static Bounds? BoundsOf(Transform t)
    {
        // visible meshes only: disabled renderers report empty bounds at the origin
        var rs = t.GetComponentsInChildren<Renderer>(false).Where(r => r.enabled && !(r is ParticleSystemRenderer)).ToArray();
        if (rs.Length == 0) return null;
        var b = rs[0].bounds;
        foreach (var r in rs) b.Encapsulate(r.bounds);
        return b;
    }

    // footprints closer than `gap` metres on the ground
    static bool Near(Bounds a, Bounds b, float gap)
    {
        return a.min.x - gap < b.max.x && b.min.x - gap < a.max.x && a.min.z - gap < b.max.z && b.min.z - gap < a.max.z;
    }

    // footprints overlap on the ground (by more than a hair)
    static bool Touch(Bounds a, Bounds b)
    {
        const float m = 0.15f;
        return a.min.x + m < b.max.x && b.min.x + m < a.max.x && a.min.z + m < b.max.z && b.min.z + m < a.max.z;
    }

    // The ground rectangle the camera can see at this aspect, plus the old (spread) terrain area, extended a
    // little past the screen edges; at the back it stops under the cliff wall.
    static Rect ViewFootprint(Camera cam, float aspect, float groundY, List<Transform> background, Vector2 C, float k, Vector3 S, StringBuilder log)
    {
        float xMin = C.x - S.x * k * 0.5f, xMax = C.x + S.x * k * 0.5f, zMin = C.y - S.z * k * 0.5f, zMax = C.y + S.z * k * 0.5f;
        // where the backdrop starts behind the board (camera looks toward -Z): the cliffs' nearest edge
        float backLimit = float.MinValue;
        foreach (var t in background)
        {
            if (!Regex.IsMatch(t.name, "cliff|gliff", RegexOptions.IgnoreCase)) continue;
            var bb = BoundsOf(t);
            // only the wall behind the board (not the side walls): behind the centre and within the board's width
            if (bb == null || bb.Value.center.z > C.y || Mathf.Abs(bb.Value.center.x - C.x) > S.x * k * 0.5f) continue;
            backLimit = Mathf.Max(backLimit, bb.Value.center.z);
        }
        if (cam)
        {
            var m = Matrix4x4.Perspective(cam.fieldOfView, aspect, cam.nearClipPlane, cam.farClipPlane);
            var inv = (m * cam.worldToCameraMatrix).inverse;
            float far = backLimit > float.MinValue ? backLimit : zMin - 200f;
            for (float vx = 0f; vx <= 1.001f; vx += 0.25f)
                for (float vy = 0f; vy <= 1.001f; vy += 0.25f)
                {
                    Vector3 a = inv.MultiplyPoint(new Vector3(vx * 2f - 1f, vy * 2f - 1f, -1f));
                    Vector3 b = inv.MultiplyPoint(new Vector3(vx * 2f - 1f, vy * 2f - 1f, 1f));
                    var d = (b - a).normalized;
                    Vector3 hit;
                    if (d.y < -1e-4f)
                    {
                        hit = a + d * ((groundY - a.y) / d.y);
                        if (hit.z < far) hit = a + d * ((far - a.z) / d.z);   // past the wall: clip to it
                    }
                    else if (Mathf.Abs(d.z) > 1e-4f) hit = a + d * ((far - a.z) / d.z);   // above the horizon: the wall
                    else continue;
                    xMin = Mathf.Min(xMin, hit.x); xMax = Mathf.Max(xMax, hit.x);
                    zMin = Mathf.Min(zMin, hit.z); zMax = Mathf.Max(zMax, hit.z);
                }
        }
        const float pad = 25f;
        var r = Rect.MinMaxRect(xMin - pad, zMin - pad, xMax + pad, zMax + pad);
        log.AppendLine($"terrain needs x {r.xMin:0}..{r.xMax:0}, z {r.yMin:0}..{r.yMax:0} (cliff line z {backLimit:0})");
        return r;
    }

    // ------------------------------------------------------------------------------------------

    static TerrainData BuildSpreadTerrain(Terrain terrain, float k, Vector2 C, Rect area, StringBuilder log)
    {
        var oldData = terrain.terrainData;
        string oldPath = AssetDatabase.GetAssetPath(oldData);
        string dir = string.IsNullOrEmpty(oldPath) ? "Assets" : Path.GetDirectoryName(oldPath).Replace('\\', '/');
        string newPath = AssetDatabase.GenerateUniqueAssetPath($"{dir}/Terrain spread {k:0.##}x.asset");
        if (string.IsNullOrEmpty(oldPath) || !AssetDatabase.CopyAsset(oldPath, newPath))
            throw new System.Exception("[Spread Board] Could not copy the terrain data.");
        var data = AssetDatabase.LoadAssetAtPath<TerrainData>(newPath);

        Vector3 S = oldData.size, P0 = terrain.transform.position;
        var S2 = new Vector3(area.width, S.y, area.height);
        var P2 = new Vector3(area.xMin, P0.y, area.yMin);
        const float fade = 40f;   // metres outside the old area over which the ground eases to flat

        // height at a new world point: un-spread to the old terrain; outside it, the edge height easing to 0
        int R = oldData.heightmapResolution;
        var old = oldData.GetHeights(0, 0, R, R);
        float HeightAt(float wx, float wz)
        {
            float ox = C.x + (wx - C.x) / k, oz = C.y + (wz - C.y) / k;
            float u = (ox - P0.x) / S.x, v = (oz - P0.z) / S.z;
            float h = Bilinear(old, R, Mathf.Clamp01(u), Mathf.Clamp01(v));
            float outX = Mathf.Max(0f, -u, u - 1f) * S.x * k, outZ = Mathf.Max(0f, -v, v - 1f) * S.z * k;   // metres outside
            float o = Mathf.Sqrt(outX * outX + outZ * outZ);
            return o <= 0f ? h : h * Mathf.SmoothStep(1f, 0f, o / fade);
        }

        // same detail per (stretched) metre as before: ~ (R-1) samples over S.x * k metres
        int R2 = ValidHeightmapRes((R - 1) * Mathf.Max(S2.x / (S.x * k), S2.z / (S.z * k)) + 1);
        var h2 = new float[R2, R2];
        for (int z = 0; z < R2; z++)
            for (int x = 0; x < R2; x++)
                h2[z, x] = HeightAt(P2.x + x / (float)(R2 - 1) * S2.x, P2.z + z / (float)(R2 - 1) * S2.z);
        data.heightmapResolution = R2;
        data.size = S2;
        data.SetHeights(0, 0, h2);
        log.AppendLine($"terrain heightmap {R}x{R} -> {R2}x{R2}, size {S2.x:0}x{S2.z:0} m, new data: {newPath}");

        if (oldData.treeInstanceCount > 0)
        {
            var trees = oldData.treeInstances;
            for (int i = 0; i < trees.Length; i++)
            {
                var p = trees[i].position;
                float wx = C.x + (P0.x + p.x * S.x - C.x) * k, wz = C.y + (P0.z + p.z * S.z - C.y) * k;
                trees[i].position = new Vector3((wx - P2.x) / S2.x, p.y, (wz - P2.z) / S2.z);
            }
            data.treeInstances = trees;
        }
        if (oldData.terrainLayers != null && oldData.terrainLayers.Length > 0)
            Debug.LogWarning("[Spread Board] Terrain has painted layers: they were not resampled.");

        EditorUtility.SetDirty(data);
        return data;
    }

    static int ValidHeightmapRes(float want)
    {
        // capped at 1025: bigger heightmaps cost several MB in the web build
        foreach (var r in new[] { 33, 65, 129, 257, 513, 1025 })
            if (r >= want) return r;
        return 1025;
    }

    static float Bilinear(float[,] a, int R, float u, float v)
    {
        float fx = Mathf.Clamp01(u) * (R - 1), fz = Mathf.Clamp01(v) * (R - 1);
        int x0 = Mathf.Min((int)fx, R - 2), z0 = Mathf.Min((int)fz, R - 2);
        float tx = fx - x0, tz = fz - z0;
        float a0 = Mathf.Lerp(a[z0, x0], a[z0, x0 + 1], tx);
        float a1 = Mathf.Lerp(a[z0 + 1, x0], a[z0 + 1, x0 + 1], tx);
        return Mathf.Lerp(a0, a1, tz);
    }

    // ------------------------------------------------------------------------------------------

    static void ScaleLookDistances(float k, StringBuilder log)
    {
        ScaleAssetDistances(k, log);
        if (RenderSettings.fogMode == FogMode.Linear)
        {
            RenderSettings.fogStartDistance *= k;
            RenderSettings.fogEndDistance *= k;
        }
        else RenderSettings.fogDensity /= k;
        log.AppendLine($"fog {RenderSettings.fogMode}: density {RenderSettings.fogDensity:0.#####}");
    }

    // Distances stored in assets (not the scene): URP shadow distance and the heat-haze material.
    static void ScaleAssetDistances(float k, StringBuilder log)
    {
        var assets = new HashSet<UniversalRenderPipelineAsset>();
        for (int i = 0; i < QualitySettings.names.Length; i++)
            if (QualitySettings.GetRenderPipelineAssetAt(i) is UniversalRenderPipelineAsset a) assets.Add(a);
        if (GraphicsSettings.defaultRenderPipeline is UniversalRenderPipelineAsset d) assets.Add(d);
        foreach (var a in assets)
        {
            a.shadowDistance *= k;
            EditorUtility.SetDirty(a);
            log.AppendLine($"shadow distance {a.name}: {a.shadowDistance:0} m");
        }
        foreach (var guid in AssetDatabase.FindAssets("t:Material"))
        {
            var m = AssetDatabase.LoadAssetAtPath<Material>(AssetDatabase.GUIDToAssetPath(guid));
            if (!m || !m.shader || m.shader.name != "Hidden/BJKIT/HeatHaze") continue;
            m.SetFloat("_StartDistance", m.GetFloat("_StartDistance") * k);
            m.SetFloat("_EndDistance", m.GetFloat("_EndDistance") * k);
            EditorUtility.SetDirty(m);
            log.AppendLine($"heat haze {m.name}: {m.GetFloat("_StartDistance"):0}-{m.GetFloat("_EndDistance"):0} m");
        }
    }
}
