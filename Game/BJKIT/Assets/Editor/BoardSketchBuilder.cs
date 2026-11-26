using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using BJKIT.BoardGame;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

// Builds the board from the map sketch (v3: user's 2nd sketch + balance proposal, map-proposal-v3.png).
// Pixel coordinates of each dot in the 1239x724 sketch.
// Tools > Board > Build From Sketch   : terrain size + all nodes/links/railway + landmarks + placeholders (replaces "Board")
// Tools > Board > Rebuild Visuals     : redraw nodes and lines after changing types or moving nodes
// Tools > Board > Export board.json   : graph for the camp server (BJKIT2026/data/board.json)
public static class BoardSketchBuilder
{
    // ---- sketch -> world ----
    const float BaseMetresPerPixel = 0.152f;           // sketch span 1053 px -> 160 m (before any spread)
    static readonly Vector2 SketchCentre = new Vector2(691.5f, 401f);
    static readonly Vector2 WorldCentre = new Vector2(8.5f, 6.7f);   // x, z (centre of the terrain)
    const float BaseTerrainWidth = 180f;
    const float BaseTerrainDepth = 100f;

    // Tools > Board > Spread Board scales the layout out from WorldCentre and stores the factor on the Board,
    // so a later Build From Sketch rebuilds at the same spread. (Spread Board also adds a border of extra
    // terrain around the layout; SizeTerrain leaves a bigger terrain alone.)
    static float layoutScale = 1f;
    static float MetresPerPixel => BaseMetresPerPixel * layoutScale;
    static float TerrainWidth => BaseTerrainWidth * layoutScale;
    static float TerrainDepth => BaseTerrainDepth * layoutScale;

    // Camera looks from +Z toward -Z, so sketch right = world -X and sketch down = world +Z (nearer the camera).
    static Vector3 ToWorld(float px, float py) => new Vector3(
        WorldCentre.x - (px - SketchCentre.x) * MetresPerPixel, 0f,
        WorldCentre.y + (py - SketchCentre.y) * MetresPerPixel);

    // S = special, E = event, H = shop, B = start (saloon), R = railway station, T = mine tunnel mouth, N = normal.
    // Events/shops are a balance proposal: change the letter here, or the node's Type in the Inspector.
    static readonly (int x, int y, char t)[] Dots =
    {
        (213,112,'N'), (355,112,'E'), (545,128,'N'), (602,128,'E'), (659,128,'N'), (754,128,'S'),
        (836,128,'N'), (659,172,'N'), (836,172,'N'), (990,172,'N'), (1036,172,'N'), (1075,172,'N'),
        (165,178,'S'), (213,178,'N'), (259,178,'N'), (355,178,'N'), (545,192,'R'), (659,216,'N'),
        (836,216,'N'), (936,216,'N'), (990,216,'E'), (1075,216,'N'), (165,265,'N'), (259,265,'N'),
        (355,265,'T'), (440,265,'T'), (497,265,'N'), (545,265,'N'), (659,265,'H'), (716,265,'N'),
        (783,265,'N'), (836,265,'N'), (889,265,'E'), (936,265,'N'), (1075,272,'E'), (1167,290,'N'),
        (1218,290,'E'), (836,308,'N'), (1075,328,'N'), (1121,328,'N'), (1167,332,'N'), (716,346,'N'),
        (836,346,'H'), (165,352,'R'), (259,352,'N'), (355,352,'N'), (431,352,'E'), (497,352,'N'),
        (775,352,'E'), (1075,383,'S'), (497,402,'N'), (557,402,'N'), (616,402,'B'), (716,402,'N'),
        (836,402,'N'), (993,431,'N'), (1075,431,'N'), (165,440,'E'), (259,451,'N'), (355,451,'N'),
        (431,451,'N'), (497,451,'H'), (616,451,'N'), (666,451,'N'), (716,451,'N'), (836,451,'N'),
        (836,494,'N'), (917,494,'N'), (990,494,'N'), (497,508,'N'), (165,520,'N'), (673,538,'N'),
        (730,538,'N'), (783,538,'N'), (836,538,'N'), (960,560,'E'), (497,575,'N'), (557,575,'E'),
        (616,575,'N'), (673,575,'N'), (836,585,'N'), (185,600,'N'), (900,600,'R'), (497,628,'N'),
        (836,628,'N'), (220,655,'S'), (497,680,'N'), (580,680,'E'), (660,680,'N'), (740,680,'N'),
        (820,680,'S'), (290,690,'N'), (360,690,'E'), (430,690,'R'),
    };

    static readonly int[][] Lines =
    {
        new[]{165,178, 213,178}, new[]{213,178, 259,178}, new[]{259,178, 355,178}, new[]{213,178, 213,112},
        new[]{213,112, 355,112}, new[]{355,112, 355,178}, new[]{259,178, 259,265}, new[]{259,265, 355,265},
        new[]{355,265, 355,352}, new[]{355,352, 259,352}, new[]{259,352, 259,451}, new[]{259,451, 355,451},
        new[]{355,451, 431,451}, new[]{431,451, 431,352}, new[]{431,352, 497,352}, new[]{497,352, 497,402},
        new[]{497,402, 497,451}, new[]{431,451, 497,451}, new[]{497,451, 497,508}, new[]{497,508, 497,575},
        new[]{497,575, 497,628}, new[]{497,628, 497,680}, new[]{497,575, 557,575}, new[]{557,575, 616,575},
        new[]{616,575, 673,575}, new[]{673,575, 673,538}, new[]{673,538, 730,538}, new[]{730,538, 783,538},
        new[]{783,538, 836,538}, new[]{497,402, 557,402}, new[]{557,402, 616,402}, new[]{616,402, 616,451},
        new[]{616,451, 666,451}, new[]{666,451, 716,451}, new[]{716,451, 716,402}, new[]{716,402, 716,346},
        new[]{716,346, 775,352}, new[]{775,352, 836,346}, new[]{440,265, 497,265}, new[]{497,265, 545,265},
        new[]{545,265, 545,192}, new[]{545,192, 545,128}, new[]{545,128, 602,128}, new[]{602,128, 659,128},
        new[]{659,128, 659,172}, new[]{659,172, 659,216}, new[]{659,216, 659,265}, new[]{659,265, 716,265},
        new[]{716,265, 783,265}, new[]{783,265, 836,265}, new[]{754,128, 836,128}, new[]{836,128, 836,172},
        new[]{836,172, 836,216}, new[]{836,216, 836,265}, new[]{836,265, 836,308}, new[]{836,308, 836,346},
        new[]{836,346, 836,402}, new[]{836,402, 836,451}, new[]{836,451, 836,494}, new[]{836,494, 836,538},
        new[]{836,538, 836,585}, new[]{836,494, 917,494}, new[]{917,494, 990,494}, new[]{836,265, 889,265},
        new[]{889,265, 936,265}, new[]{936,265, 936,216}, new[]{936,216, 990,216}, new[]{990,216, 990,172},
        new[]{990,172, 1036,172}, new[]{1036,172, 1075,172}, new[]{355,265, 440,265}, new[]{1075,172, 1075,216},
        new[]{1075,216, 1075,272}, new[]{1075,272, 1075,328}, new[]{1075,328, 1075,383}, new[]{1075,383, 1075,431},
        new[]{1075,328, 1121,328}, new[]{1121,328, 1167,332}, new[]{1167,332, 1167,290}, new[]{1167,290, 1218,290},
        new[]{497,680, 580,680}, new[]{580,680, 660,680}, new[]{660,680, 740,680}, new[]{740,680, 820,680},
        new[]{820,680, 836,628}, new[]{836,628, 836,585}, new[]{836,585, 900,600}, new[]{900,600, 960,560},
        new[]{960,560, 990,494}, new[]{917,494, 993,431}, new[]{993,431, 1075,431}, new[]{165,178, 165,265},
        new[]{165,265, 165,352}, new[]{659,128, 754,128}, new[]{165,352, 165,440}, new[]{165,440, 165,520},
        new[]{165,520, 185,600}, new[]{185,600, 220,655}, new[]{220,655, 290,690}, new[]{290,690, 360,690},
        new[]{360,690, 430,690}, new[]{430,690, 497,680},
    };

    static readonly Dictionary<(int, int), string> Labels = new Dictionary<(int, int), string>
    {
        { (754,128), "Dead Wood" },
        { (220,655), "Old Mine" },
        { (1075,383), "Waterfall" },
        { (165,178), "Eagle Peak" },
        { (820,680), "Skull Flats" },
        { (165,352), "West Station" },
        { (545,192), "North Station" },
        { (900,600), "River Station" },
        { (430,690), "Mine Station" },
        { (616,402), "Saloon" },
        { (1218,290), "Gold Panning" },
    };

    // Railway: a ring West -> North -> River -> Mine -> West (ride to a neighbouring station).
    static readonly (int, int)[] RailRing = { (165, 352), (545, 192), (900, 600), (430, 690) };

    // Party-board-game palette (bright, saturated token centres, white rims). Change a colour here, then
    // Tools > Board > Rebuild Visuals. Each type keeps its own colour so it reads at a glance:
    static readonly Color TokNormal = Hex("2E7CF6");    // blue: an ordinary step
    static readonly Color TokEvent = Hex("E8473B");     // red: something happens
    static readonly Color TokSpecial = Hex("FFC21A");   // gold, glowing: the 5 specials
    static readonly Color TokShop = Hex("9B5CF6");      // purple diamond: shop
    static readonly Color TokStart = Hex("FFF6E0");     // cream centre with a gold rim: the Saloon start
    static readonly Color TokStation = Hex("F08A24");   // orange on a wooden platform: railway station
    static readonly Color TokTunnel = Hex("2EC8E6");    // cyan: the mine tunnel pair
    static readonly Color RimWhite = Hex("FFFFFF");
    static readonly Color RimGold = Hex("FFC21A");
    static readonly Color Wood = Hex("7A4A22");
    // Paths: near-white core with a soft green glow (like the reference board game). HDR core = slight bloom.
    static readonly Color PathCore = new Color(1.7f, 1.75f, 1.6f, 1f);
    static readonly Color PathGlow = new Color(0.45f, 1f, 0.4f, 0.55f);

    const string MatDir = "Assets/Board/Materials";

    [MenuItem("Tools/Board/Build From Sketch")]
    public static void Build()
    {
        var existing = GameObject.Find("Board");
        var oldBoard = existing ? existing.GetComponent<Board>() : null;
        layoutScale = oldBoard && oldBoard.layoutScale > 0f ? oldBoard.layoutScale : 1f;
        SizeTerrain();

        if (existing) Undo.DestroyObjectImmediate(existing);

        var rootGo = new GameObject("Board");
        Undo.RegisterCreatedObjectUndo(rootGo, "Build Board");
        var board = rootGo.AddComponent<Board>();
        board.layoutScale = layoutScale;
        AssignMaterials(board);

        var nodesRoot = new GameObject("Nodes");
        nodesRoot.transform.SetParent(rootGo.transform, false);

        var byPixel = new Dictionary<(int, int), BoardNode>();
        int i = 0;
        foreach (var (x, y, t) in Dots)
        {
            i++;
            var type = t == 'S' ? NodeType.Special : t == 'E' ? NodeType.Event : t == 'H' ? NodeType.Shop
                     : t == 'B' ? NodeType.Start : t == 'R' ? NodeType.Station : t == 'T' ? NodeType.Tunnel : NodeType.Normal;
            Labels.TryGetValue((x, y), out var label);
            var go = new GameObject(string.IsNullOrEmpty(label) ? $"n{i:00} {type}" : $"n{i:00} {type} ({label})");
            go.transform.SetParent(nodesRoot.transform, false);
            go.transform.position = ToWorld(x, y);
            var node = go.AddComponent<BoardNode>();
            node.id = $"n{i:00}";
            node.type = type;
            node.label = label ?? "";
            byPixel[(x, y)] = node;
            if (type == NodeType.Start) board.startNode = node;
        }
        foreach (var l in Lines)
            Board.Link(byPixel[(l[0], l[1])], byPixel[(l[2], l[3])]);
        for (int k = 0; k < RailRing.Length; k++)
            Board.RailLink(byPixel[RailRing[k]], byPixel[RailRing[(k + 1) % RailRing.Length]]);

        board.RebuildVisuals();
        PlaceLandmarks();
        BuildPlaceholders();

        EditorSceneManager.MarkSceneDirty(rootGo.scene);
        Selection.activeGameObject = rootGo;
        Debug.Log($"[Board] Built {Dots.Length} nodes, {Lines.Length} links, {RailRing.Length} stations. Save the scene (Ctrl+S).");
    }

    [MenuItem("Tools/Board/Rebuild Visuals")]
    public static void Rebuild()
    {
        var board = Object.FindAnyObjectByType<Board>();
        if (!board) { Debug.LogWarning("[Board] No Board in the scene. Use Tools > Board > Build From Sketch."); return; }
        AssignMaterials(board);
        board.RebuildVisuals();
        EditorSceneManager.MarkSceneDirty(board.gameObject.scene);
    }

    // Graph only (ids, types, labels, links, railway, start, rules) so the camp server can check moves and place pawns.
    [MenuItem("Tools/Board/Export board.json")]
    public static void Export()
    {
        var board = Object.FindAnyObjectByType<Board>();
        if (!board) { Debug.LogWarning("[Board] No Board in the scene."); return; }
        var sb = new StringBuilder();
        sb.Append("{\n  \"start\": \"").Append(board.startNode ? board.startNode.id : "").Append("\",\n");
        sb.Append("  \"diceFaces\": [").Append(string.Join(", ", board.diceFaces)).Append("],\n");
        sb.Append("  \"rollCost\": ").Append(board.rollCost).Append(",\n");
        sb.Append("  \"rideCost\": ").Append(board.rideCost).Append(",\n");
        sb.Append("  \"stopOnSpecial\": ").Append(board.stopOnSpecial ? "true" : "false").Append(",\n");
        sb.Append("  \"bounceAtDeadEnd\": ").Append(board.bounceAtDeadEnd ? "true" : "false").Append(",\n");
        sb.Append("  \"nodes\": [\n");
        var nodes = board.Nodes.OrderBy(n => n.id).ToList();
        for (int k = 0; k < nodes.Count; k++)
        {
            var n = nodes[k];
            sb.Append("    { \"id\": \"").Append(n.id).Append("\", \"type\": \"").Append(n.type.ToString().ToLowerInvariant()).Append("\"");
            if (!string.IsNullOrEmpty(n.label)) sb.Append(", \"label\": \"").Append(n.label.Replace("\"", "\\\"")).Append("\"");
            sb.Append(", \"links\": [").Append(string.Join(", ", n.links.Where(x => x).Select(x => $"\"{x.id}\""))).Append("]");
            if (n.railLinks.Count > 0) sb.Append(", \"rail\": [").Append(string.Join(", ", n.railLinks.Where(x => x).Select(x => $"\"{x.id}\""))).Append("]");
            sb.Append(" }").Append(k < nodes.Count - 1 ? ",\n" : "\n");
        }
        sb.Append("  ]\n}\n");
        var path = Path.GetFullPath(Path.Combine(Application.dataPath, "../../../data/board.json"));
        File.WriteAllText(path, sb.ToString());
        Debug.Log("[Board] Exported " + path);
    }

    // ---------------------------------------------------------------------------------

    static void SizeTerrain()
    {
        var t = Terrain.activeTerrain;
        if (!t) return;
        var s = t.terrainData.size;
        if (s.x > TerrainWidth + 0.5f && s.z > TerrainDepth + 0.5f) return;   // already bigger (Spread Board border): keep it
        Undo.RecordObject(t.terrainData, "Size terrain");
        Undo.RecordObject(t.transform, "Size terrain");
        t.terrainData.size = new Vector3(TerrainWidth, s.y, TerrainDepth);
        var p = t.transform.position;
        t.transform.position = new Vector3(WorldCentre.x - TerrainWidth / 2f, p.y, WorldCentre.y - TerrainDepth / 2f);
        EditorUtility.SetDirty(t.terrainData);
    }

    static float Ground(Vector3 p)
    {
        var t = Terrain.activeTerrain;
        return t ? t.SampleHeight(p) + t.transform.position.y : 4f;
    }

    static Bounds? BoundsOf(GameObject g)
    {
        var rs = g.GetComponentsInChildren<Renderer>();
        if (rs.Length == 0) return null;
        var b = rs[0].bounds;
        foreach (var r in rs) b.Encapsulate(r.bounds);
        return b;
    }

    // Moves a group of props so the FIRST one's centre lands on the sketch point and sits on the sand.
    // scale > 0 sets an absolute uniform scale on each first (the fbx props import at 50).
    static void Place(string[] names, float px, float py, float scale = 0f, float sink = 0.2f)
    {
        var gos = names.Select(GameObject.Find).Where(g => g).ToList();
        if (gos.Count == 0) { Debug.LogWarning("[Board] Prop not found: " + string.Join(", ", names)); return; }
        foreach (var g in gos) Undo.RecordObject(g.transform, "Place landmarks");
        if (scale > 0f) foreach (var g in gos) g.transform.localScale = Vector3.one * scale;
        var b0 = BoundsOf(gos[0]);
        if (b0 == null) return;
        var target = ToWorld(px, py);
        var c = b0.Value.center;
        var delta = new Vector3(target.x - c.x, Ground(target) - b0.Value.min.y - sink, target.z - c.z);
        foreach (var g in gos) g.transform.position += delta;
    }

    // Landmarks from the props in "ICTP camp game map assests" (see map-proposal-v3.png).
    static void PlaceLandmarks()
    {
        Place(new[] { "Hill1", "Sanded1" }, 450, 180, 26f, 0.3f);      // BIG MESA (Eagle Peak side, mine tunnel under it)
        Place(new[] { "Hill2", "Sanded2" }, 1045, 108, 25f, 0.3f);     // small mesa, top-right corner
        Place(new[] { "Rock3" }, 307, 308, 33f);                             // small mountain, left
        Place(new[] { "DeadTree1" }, 307, 400, 38f);                         // trees inside the left loop
        Place(new[] { "DeadTree2" }, 748, 195);                         // DEAD WOOD
        Place(new[] { "Cac3" }, 790, 232, 0f, 0.1f);
        Place(new[] { "Cas4" }, 705, 232, 0f, 0.1f);
        Place(new[] { "Skull" }, 776, 486, 150f);                       // GIANT SKULL
        Place(new[] { "Cartrigags" }, 690, 628, 0f, 0.3f);              // bone arch on Skull Flats
        // SALOON town around the start
        Place(new[] { "Building3" }, 620, 328, 0f, 0.1f);
        Place(new[] { "Building2" }, 560, 330, 0f, 0.1f);
        Place(new[] { "Building1" }, 680, 330, 0f, 0.1f);
        Place(new[] { "Building4" }, 560, 508, 0f, 0.1f);
        Place(new[] { "Building2.2" }, 622, 508, 0f, 0.1f);
        Place(new[] { "Fence" }, 588, 296, 0f, 0.1f);
        Place(new[] { "Fence.001" }, 652, 296, 0f, 0.1f);
        Place(new[] { "Cac1" }, 592, 372, 0f, 0.1f);
        Place(new[] { "Cac2" }, 652, 372, 0f, 0.1f);
        Place(new[] { "Pebbles" }, 690, 372, 0f, 0.05f);
        Place(new[] { "Dead Bush" }, 700, 300, 0f, 0.1f);
        Place(new[] { "Grass" }, 530, 300, 0f, 0.1f);
        // ABANDONED MINE yard
        Place(new[] { "Rail", "MineCart", "MineCart2" }, 330, 560, 0f, 0.05f);
        Place(new[] { "Rock1" }, 420, 520);
        Place(new[] { "Rock2" }, 960, 345);
    }

    // Landmarks with no model yet: empty objects with a BoxCollider (PlaceholderBox draws them in the Scene view).
    static void BuildPlaceholders()
    {
        var old = GameObject.Find("Landmarks (placeholders)");
        if (old) Undo.DestroyObjectImmediate(old);
        var root = new GameObject("Landmarks (placeholders)");
        Undo.RegisterCreatedObjectUndo(root, "Placeholders");

        void Box(string name, float px, float py, Vector3 size, float yaw = 0f, string note = "")
        {
            var go = new GameObject(name);
            go.transform.SetParent(root.transform, false);
            var p = ToWorld(px, py);
            go.transform.position = new Vector3(p.x, Ground(p), p.z);
            go.transform.rotation = Quaternion.Euler(0f, yaw, 0f);
            var col = go.AddComponent<BoxCollider>();
            col.size = size;
            col.center = new Vector3(0f, size.y * 0.5f, 0f);
            go.AddComponent<PlaceholderBox>().note = note;
        }

        // River: one box per stretch, from the waterfall at the top-right down to the bottom edge.
        var river = new (float x, float y)[] { (1245, 350), (1200, 395), (1155, 440), (1115, 480), (1065, 525), (1045, 565), (1032, 605), (992, 655), (957, 705) };
        for (int k = 0; k < river.Length - 1; k++)
        {
            Vector3 a = ToWorld(river[k].x, river[k].y), b = ToWorld(river[k + 1].x, river[k + 1].y);
            var mid = (a + b) * 0.5f;
            var dir = b - a;
            float yaw = Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg;
            var go = new GameObject($"PH River {k + 1}");
            go.transform.SetParent(root.transform, false);
            go.transform.position = new Vector3(mid.x, Ground(mid) - 0.3f, mid.z);
            go.transform.rotation = Quaternion.Euler(0f, yaw, 0f);
            var col = go.AddComponent<BoxCollider>();
            col.size = new Vector3(6f, 0.6f, dir.magnitude + 2f);
            col.center = new Vector3(0f, 0.3f, 0f);
            go.AddComponent<PlaceholderBox>().note = "River (water surface).";
        }
        Box("PH Waterfall", 1240, 345, new Vector3(12f, 10f, 6f), 0f, "Waterfall where the river starts (special: Waterfall).");
        Box("PH Gold Panning Camp", 1195, 250, new Vector3(6f, 3f, 6f), 0f, "Gold-panning camp at the river source (reward event at the end of the spur).");
        Box("PH Mine Entrance", 150, 690, new Vector3(10f, 8f, 6f), 0f, "Abandoned mine entrance (special: Old Mine).");
        Box("PH Mine Tunnel", 397, 252, new Vector3(7f, 5f, 5f), 0f, "Tunnel through the big mesa (between the two blue Tunnel nodes).");
        Box("PH West Station", 112, 352, new Vector3(6f, 4f, 8f), 0f, "Railway station (West).");
        Box("PH North Station", 602, 192, new Vector3(8f, 4f, 5f), 0f, "Railway station (North).");
        Box("PH River Station", 900, 650, new Vector3(8f, 4f, 5f), 0f, "Railway station (River).");
        Box("PH Mine Station", 430, 648, new Vector3(8f, 4f, 5f), 0f, "Railway station (Mine).");
    }

    static void AssignMaterials(Board b)
    {
        b.normalMat = Mat("Node_Normal", TokNormal, RimWhite, 0f);
        b.specialMat = Mat("Node_Special", TokSpecial, RimWhite, 0.7f);
        b.eventMat = Mat("Node_Event", TokEvent, RimWhite, 0f);
        b.shopMat = Mat("Node_Shop", TokShop, RimWhite, 0f);
        b.startMat = Mat("Node_Start", TokStart, RimGold, 0f);
        b.stationMat = Mat("Node_Station", TokStation, RimWhite, 0f);
        b.tunnelMat = Mat("Node_Tunnel", TokTunnel, RimWhite, 0.2f);
        b.platformMat = Mat("Node_Platform", Wood, Wood, 0f);   // plain cube: no vertex colours, so Rim = Colour
        b.blobMat = BlobMat("Node_Shadow");
        b.pathMat = PathMat("Path");
        EditorUtility.SetDirty(b);
    }

    // Tokens use BJKIT/BoardToken: chunky plastic look (soft sun shading + gloss), no shadows, fog or SSAO,
    // so they always read as a clear layer on top of the world.
    static Material Mat(string name, Color centre, Color rim, float glow)
    {
        var shader = Shader.Find("BJKIT/BoardToken");
        var m = LoadOrCreate(name, shader);
        m.shader = shader;
        m.SetColor("_BaseColor", centre);
        m.SetColor("_RimColor", rim);
        m.SetColor("_EmissionColor", glow > 0f ? centre * glow : Color.black);
        EditorUtility.SetDirty(m);
        return m;
    }

    static Material PathMat(string name)
    {
        var shader = Shader.Find("BJKIT/BoardPath");
        var m = LoadOrCreate(name, shader);
        m.shader = shader;
        m.SetColor("_CoreColor", PathCore);
        m.SetColor("_GlowColor", PathGlow);
        EditorUtility.SetDirty(m);
        return m;
    }

    static Material BlobMat(string name)
    {
        var shader = Shader.Find("BJKIT/BoardBlob");
        var m = LoadOrCreate(name, shader);
        m.shader = shader;
        m.SetColor("_BaseColor", new Color(0.12f, 0.08f, 0.05f, 0.35f));
        m.SetFloat("_Softness", 0.55f);
        EditorUtility.SetDirty(m);
        return m;
    }

    static Material LoadOrCreate(string name, Shader shader)
    {
        if (!AssetDatabase.IsValidFolder("Assets/Board")) AssetDatabase.CreateFolder("Assets", "Board");
        if (!AssetDatabase.IsValidFolder(MatDir)) AssetDatabase.CreateFolder("Assets/Board", "Materials");
        string path = $"{MatDir}/{name}.mat";
        var m = AssetDatabase.LoadAssetAtPath<Material>(path);
        if (!m) { m = new Material(shader); AssetDatabase.CreateAsset(m, path); }
        return m;
    }

    static Color Hex(string hex) => ColorUtility.TryParseHtmlString("#" + hex, out var c) ? c : Color.magenta;
}
