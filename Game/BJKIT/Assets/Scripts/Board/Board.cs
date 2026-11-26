using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.Rendering;

namespace BJKIT.BoardGame
{
    /// The node map: the walking rules plus the look of nodes and lines.
    /// Keep the rules here (not in UI code) so the Unity view and the camp server can share them.
    [ExecuteAlways]
    public class Board : MonoBehaviour
    {
        [Header("Rules")]
        public BoardNode startNode;
        [Tooltip("The faces of the die. 2,3,3,4,4,5 = an 'average die': same average as a d6 (3.5) " +
                 "but no 1s or 6s, so lucky/unlucky streaks matter about half as much. Use 1..6 for a normal d6.")]
        public int[] diceFaces = { 2, 3, 3, 4, 4, 5 };
        [Tooltip("Money one dice roll costs (camp money = clan score + admin adjustments).")]
        [Min(0)] public int rollCost = 20;
        [Tooltip("Walking onto a yellow node ends the move there, so a special can never be skipped by the dice.")]
        public bool stopOnSpecial = true;
        [Tooltip("With steps left at a dead end, the pawn turns around and keeps walking.")]
        public bool bounceAtDeadEnd = true;
        [Tooltip("Money a train ride costs: a clan that ends its move on a station may ride to another station.")]
        [Min(0)] public int rideCost = 10;

        [Header("Look: node tokens (Shaders/BoardToken.shader)")]
        [Tooltip("Each material: Colour = the token's centre, Rim = its raised outer ring.")]
        public Material normalMat;
        public Material specialMat;
        public Material eventMat;
        public Material shopMat;
        public Material startMat;
        public Material stationMat;
        public Material tunnelMat;
        [Tooltip("The wooden platform under a station token.")]
        public Material platformMat;
        public float nodeDiameter = 4.2f;
        public float specialDiameter = 5.6f;
        [Tooltip("Token height (specials and the start are 1.3x).")]
        public float tokenHeight = 0.6f;
        [Tooltip("Width of the raised outer ring, as a share of the radius.")]
        [Range(0.05f, 0.5f)] public float rimFraction = 0.22f;
        [Tooltip("Rounded top edge of the token (m).")]
        public float tokenBevel = 0.14f;
        [Tooltip("How far the coloured centre sits below the ring (m).")]
        public float tokenRecess = 0.08f;
        public float lift = 0.12f;
        [Tooltip("Soft round shadow under each token. Empty = none.")]
        public Material blobMat;
        [Tooltip("Shadow size compared with the token.")]
        public float blobScale = 1.4f;

        [Header("Look: paths (Shaders/BoardPath.shader)")]
        [Tooltip("Glowing line drawn on the sand between linked nodes.")]
        public Material pathMat;
        [Tooltip("Full width of the path ribbon including its soft glow (m). The bright core is a share of it, set on the material.")]
        public float pathWidth = 2.2f;
        [Tooltip("How closely the path follows the dunes (m between points).")]
        public float pathStep = 0.5f;
        [Tooltip("Height above the sand (m): just enough not to flicker.")]
        public float pathLift = 0.06f;
        [Tooltip("Snap nodes to the terrain and redraw lines while you drag nodes in the editor.")]
        public bool liveEdit = true;
        [Tooltip("How much the whole layout has been spread out (Tools > Board > Spread Board). " +
                 "Build From Sketch multiplies its sketch-to-metres scale and terrain size by this, so a rebuild keeps the spread.")]
        public float layoutScale = 1f;

        public IEnumerable<BoardNode> Nodes => GetComponentsInChildren<BoardNode>(true);
        public BoardNode Find(string id) => Nodes.FirstOrDefault(n => n.id == id);

        public int RollDie() => diceFaces != null && diceFaces.Length > 0
            ? diceFaces[Random.Range(0, diceFaces.Length)]
            : Random.Range(1, 7);

        /// Railway: where a clan standing on this station can ride to (empty for other nodes).
        public IEnumerable<BoardNode> RailDestinations(BoardNode from) =>
            from && from.type == NodeType.Station ? from.railLinks.Where(n => n) : Enumerable.Empty<BoardNode>();

        public static void RailLink(BoardNode a, BoardNode b)
        {
            if (!a || !b || a == b) return;
            if (!a.railLinks.Contains(b)) a.railLinks.Add(b);
            if (!b.railLinks.Contains(a)) b.railLinks.Add(a);
        }

        public static void Link(BoardNode a, BoardNode b)
        {
            if (!a || !b || a == b) return;
            if (!a.links.Contains(b)) a.links.Add(b);
            if (!b.links.Contains(a)) b.links.Add(a);
        }

        // ---------------- movement ----------------

        /// Every way to walk `steps` from `from` without turning back (except at dead ends).
        /// cameFrom = the node the pawn arrived from last turn (null at the start: any direction).
        /// Each path lists the nodes stepped on, last one = where the pawn ends.
        /// A path can be shorter than `steps` when stopOnSpecial ends it on a yellow node.
        public List<List<BoardNode>> Paths(BoardNode from, BoardNode cameFrom, int steps)
        {
            var result = new List<List<BoardNode>>();
            Walk(from, cameFrom, steps, new List<BoardNode>(), result);
            return result;
        }

        void Walk(BoardNode at, BoardNode prev, int left, List<BoardNode> path, List<List<BoardNode>> result)
        {
            bool stoppedOnSpecial = stopOnSpecial && path.Count > 0 && at.type == NodeType.Special;
            if (left == 0 || stoppedOnSpecial)
            {
                result.Add(new List<BoardNode>(path));
                return;
            }
            var next = at.links.Where(n => n && n != prev).ToList();
            if (next.Count == 0 && bounceAtDeadEnd && prev) next.Add(prev);
            if (next.Count == 0)
            {
                result.Add(new List<BoardNode>(path));
                return;
            }
            foreach (var n in next)
            {
                path.Add(n);
                Walk(n, at, left - 1, path, result);
                path.RemoveAt(path.Count - 1);
            }
        }

        /// Fewest steps between two nodes (-1 if not connected).
        public int Distance(BoardNode a, BoardNode b)
        {
            if (a == b) return 0;
            var dist = new Dictionary<BoardNode, int> { [a] = 0 };
            var q = new Queue<BoardNode>();
            q.Enqueue(a);
            while (q.Count > 0)
            {
                var u = q.Dequeue();
                foreach (var v in u.links)
                {
                    if (!v || dist.ContainsKey(v)) continue;
                    dist[v] = dist[u] + 1;
                    if (v == b) return dist[v];
                    q.Enqueue(v);
                }
            }
            return -1;
        }

        // ---------------- look ----------------

        public float GroundY(Vector3 p)
        {
            var t = Terrain.activeTerrain;
            return t ? t.SampleHeight(p) + t.transform.position.y : p.y;
        }

        public void SnapToGround()
        {
            foreach (var n in Nodes)
            {
                var p = n.transform.position;
                p.y = GroundY(p);
                n.transform.position = p;
                n.transform.hasChanged = false;
            }
        }

        public void RebuildVisuals()
        {
            SnapToGround();
            foreach (var n in Nodes) BuildNode(n);
            BuildEdges();
        }

        // Party-board-game tokens: one generated mesh per shape (see TokenMesh), centre colour + raised rim
        // from the material (BoardToken shader), and a soft shadow on the sand.
        void BuildNode(BoardNode n)
        {
            var old = n.transform.Find("_Visual");
            if (old) DestroyImmediate(old.gameObject);
            var root = new GameObject("_Visual");
            root.transform.SetParent(n.transform, false);

            float r = nodeDiameter * 0.5f, big = specialDiameter * 0.5f;
            float outer;   // outer radius, for the shadow
            switch (n.type)
            {
                case NodeType.Special:
                    outer = Token(root, big, tokenHeight * 1.3f, 48, specialMat, 0f, 0f);
                    break;
                case NodeType.Start:
                    outer = Token(root, big * 1.25f, tokenHeight * 1.3f, 48, startMat, 0f, 0f);
                    break;
                case NodeType.Shop:
                    // diamond: a 4-sided token, corners on the world axes (= pointing up/down/left/right on
                    // screen with the camera's 180° heading); corner radius a bit bigger so it looks the same size
                    outer = Token(root, r * 1.25f, tokenHeight * 1.15f, 4, shopMat, 0f, 0f);
                    break;
                case NodeType.Station:
                    // wooden platform with a smaller token on it
                    float side = nodeDiameter * 1.35f, ph = tokenHeight * 0.6f;
                    var plat = GameObject.CreatePrimitive(PrimitiveType.Cube);
                    plat.name = "Platform";
                    plat.transform.SetParent(root.transform, false);
                    plat.transform.localScale = new Vector3(side, ph, side);
                    plat.transform.localPosition = Vector3.up * (ph * 0.5f + lift);
                    var pr = plat.GetComponent<Renderer>();
                    pr.sharedMaterial = platformMat;
                    pr.shadowCastingMode = ShadowCastingMode.Off;
                    Token(root, r * 0.8f, tokenHeight, 48, stationMat, 0f, ph);
                    outer = side * 0.6f;
                    break;
                case NodeType.Tunnel:
                    outer = Token(root, r * 1.1f, tokenHeight, 48, tunnelMat, 0f, 0f);
                    break;
                case NodeType.Event:
                    outer = Token(root, r, tokenHeight, 48, eventMat, 0f, 0f);
                    break;
                default:
                    outer = Token(root, r, tokenHeight, 48, normalMat, 0f, 0f);
                    break;
            }
            Shadow(root, outer);
        }

        float Token(GameObject root, float radius, float height, int sides, Material mat, float yaw, float y)
        {
            var g = new GameObject("Token");
            g.transform.SetParent(root.transform, false);
            g.transform.localPosition = Vector3.up * (lift + y);
            g.transform.localRotation = Quaternion.Euler(0f, yaw, 0f);
            g.AddComponent<MeshFilter>().sharedMesh = TokenMesh(radius, height, sides);
            var mr = g.AddComponent<MeshRenderer>();
            mr.sharedMaterial = mat;
            mr.shadowCastingMode = ShadowCastingMode.Off;   // flat tokens: their shadow is the soft blob below
            mr.receiveShadows = false;
            var col = g.AddComponent<BoxCollider>();         // for clicks later
            col.size = new Vector3(radius * 2f, height, radius * 2f);
            col.center = Vector3.up * (height * 0.5f);
            return radius;
        }

        void Shadow(GameObject root, float outerRadius)
        {
            if (!blobMat) return;
            var q = GameObject.CreatePrimitive(PrimitiveType.Quad);
            q.name = "Shadow";
            DestroyImmediate(q.GetComponent<Collider>());
            q.transform.SetParent(root.transform, false);
            q.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);   // lie flat, facing up
            q.transform.localPosition = Vector3.up * (lift * 0.4f);
            float s = outerRadius * 2f * blobScale;
            q.transform.localScale = new Vector3(s, s, 1f);
            var rr = q.GetComponent<Renderer>();
            rr.sharedMaterial = blobMat;
            rr.shadowCastingMode = ShadowCastingMode.Off;
            rr.receiveShadows = false;
        }

        // ---------- token mesh ----------
        // A lathe around the Y axis. Profile from the outside in:
        //   side wall -> rounded (bevelled) top edge -> flat top of the raised ring -> small step down
        //   -> recessed centre disc.
        // Vertex colour red = 1 on the centre disc, 0 on the ring and sides: the shader paints the centre in
        // the material's Colour and the rest in its Rim colour. 4 sides = a square (shop diamond) with flat faces.
        static readonly Dictionary<string, Mesh> tokenMeshes = new Dictionary<string, Mesh>();

        Mesh TokenMesh(float R, float H, int sides)
        {
            string key = $"{R:F3}|{H:F3}|{sides}|{rimFraction:F3}|{tokenBevel:F3}|{tokenRecess:F3}";
            if (tokenMeshes.TryGetValue(key, out var cached) && cached) return cached;

            float b = Mathf.Min(tokenBevel, H * 0.4f, R * 0.2f);
            float ri = R * (1f - rimFraction);
            float d = Mathf.Min(tokenRecess, H * 0.5f);
            float s = Mathf.Min(0.08f, (R - b - ri) * 0.4f);
            // (r0, y0) -> (r1, y1), centre?
            var bands = new (Vector2 a, Vector2 c, bool centre)[]
            {
                (new Vector2(R, 0f), new Vector2(R, H - b), false),           // side
                (new Vector2(R, H - b), new Vector2(R - b * 0.3f, H - b * 0.3f), false),   // bevel, lower half
                (new Vector2(R - b * 0.3f, H - b * 0.3f), new Vector2(R - b, H), false),   // bevel, upper half
                (new Vector2(R - b, H), new Vector2(ri + s, H), false),        // top of the ring
                (new Vector2(ri + s, H), new Vector2(ri, H - d), false),       // step down to the centre
                (new Vector2(ri, H - d), new Vector2(0f, H - d), true),        // centre disc
            };
            bool flat = sides <= 8;
            var verts = new List<Vector3>();
            var norms = new List<Vector3>();
            var cols = new List<Color32>();
            var tris = new List<int>();
            var centreCol = new Color32(255, 0, 0, 255);
            var rimCol = new Color32(0, 0, 0, 255);

            foreach (var (a, c, centre) in bands)
            {
                var t = c - a;
                var n2 = new Vector2(t.y, -t.x).normalized;   // outward/up in the profile plane
                for (int i = 0; i < sides; i++)
                {
                    float a0 = (i / (float)sides) * Mathf.PI * 2f, a1 = ((i + 1) / (float)sides) * Mathf.PI * 2f;
                    float am = (a0 + a1) * 0.5f;
                    int v = verts.Count;
                    foreach (var (pr, ang) in new[] { (a, a0), (a, a1), (c, a0), (c, a1) })
                    {
                        float na = flat ? am : ang;
                        // flat sides: the corner radius is R, so the face normal points at the face middle
                        verts.Add(new Vector3(pr.x * Mathf.Cos(ang), pr.y, pr.x * Mathf.Sin(ang)));
                        norms.Add(new Vector3(n2.x * Mathf.Cos(na), n2.y, n2.x * Mathf.Sin(na)).normalized);
                        cols.Add(centre ? centreCol : rimCol);
                    }
                    tris.AddRange(new[] { v, v + 2, v + 1, v + 1, v + 2, v + 3 });
                }
            }

            var m = new Mesh { name = $"BoardToken {R:F2}x{H:F2} ({sides})" };
            m.SetVertices(verts);
            m.SetNormals(norms);
            m.SetColors(cols);
            m.SetTriangles(tris, 0);
            m.RecalculateBounds();
            tokenMeshes[key] = m;
            return m;
        }

        // ---------- paths ----------
        // A flat ribbon that follows the sand closely (a point every pathStep metres), drawn by the BoardPath
        // shader as a bright core with a soft glow to both sides: it reads as a glowing line painted on the
        // terrain. The ribbon's V coordinate runs across it (0..1), U along it in ribbon widths (Tile mode).
        void BuildEdges()
        {
            var old = transform.Find("_Edges");
            if (old) DestroyImmediate(old.gameObject);
            var root = new GameObject("_Edges");
            root.transform.SetParent(transform, false);

            var done = new HashSet<(BoardNode, BoardNode)>();
            foreach (var a in Nodes)
            {
                foreach (var b in a.links)
                {
                    if (!b || done.Contains((b, a))) continue;
                    done.Add((a, b));

                    Vector3 A = a.transform.position, B = b.transform.position;
                    int seg = Mathf.Max(2, Mathf.CeilToInt(Vector3.Distance(A, B) / Mathf.Max(0.1f, pathStep)));
                    var pts = new Vector3[seg + 1];
                    for (int i = 0; i <= seg; i++)
                    {
                        var p = Vector3.Lerp(A, B, i / (float)seg);
                        p.y = GroundY(p) + pathLift;
                        pts[i] = p;
                    }

                    var go = new GameObject($"{a.id}-{b.id}");
                    go.transform.SetParent(root.transform, false);
                    go.transform.rotation = Quaternion.Euler(90f, 0f, 0f);   // ribbon lies flat on the ground
                    var lr = go.AddComponent<LineRenderer>();
                    lr.useWorldSpace = true;
                    lr.alignment = LineAlignment.TransformZ;
                    lr.widthMultiplier = pathWidth;
                    lr.textureMode = LineTextureMode.Tile;
                    lr.numCapVertices = 0;   // ends hide under the tokens
                    lr.sharedMaterial = pathMat;
                    lr.shadowCastingMode = ShadowCastingMode.Off;
                    lr.receiveShadows = false;
                    lr.positionCount = pts.Length;
                    lr.SetPositions(pts);
                }
            }
        }

#if UNITY_EDITOR
        void Update()
        {
            if (Application.isPlaying || !liveEdit) return;
            bool moved = false;
            foreach (var n in Nodes)
                if (n.transform.hasChanged) { moved = true; break; }
            if (!moved) return;
            SnapToGround();
            BuildEdges();
        }
#endif
    }
}
