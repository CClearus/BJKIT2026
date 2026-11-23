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

        [Header("Look")]
        public Material stationMat;
        public Material tunnelMat;
        public Material normalMat;
        public Material specialMat;
        public Material eventMat;
        public Material eventRingMat;
        public Material shopMat;
        public Material startMat;
        public Material edgeMat;
        public float nodeDiameter = 4.2f;
        public float specialDiameter = 5.6f;
        public float nodeThickness = 0.5f;
        public float edgeWidth = 0.9f;
        public float lift = 0.12f;
        [Tooltip("Snap nodes to the terrain and redraw lines while you drag nodes in the editor.")]
        public bool liveEdit = true;

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

        void BuildNode(BoardNode n)
        {
            var old = n.transform.Find("_Visual");
            if (old) DestroyImmediate(old.gameObject);
            var root = new GameObject("_Visual");
            root.transform.SetParent(n.transform, false);

            switch (n.type)
            {
                case NodeType.Special:
                    Disc(root, specialDiameter, nodeThickness * 1.4f, specialMat, "Disc");
                    break;
                case NodeType.Event:
                    Disc(root, nodeDiameter * 1.3f, nodeThickness * 0.7f, eventRingMat, "Ring");
                    Disc(root, nodeDiameter, nodeThickness, eventMat, "Disc");
                    break;
                case NodeType.Shop:
                    var d = GameObject.CreatePrimitive(PrimitiveType.Cube);
                    d.name = "Diamond";
                    d.transform.SetParent(root.transform, false);
                    d.transform.localRotation = Quaternion.Euler(0f, 45f, 0f);
                    d.transform.localScale = new Vector3(nodeDiameter * 0.8f, nodeThickness * 1.4f, nodeDiameter * 0.8f);
                    d.transform.localPosition = Vector3.up * (nodeThickness * 0.7f + lift);
                    d.GetComponent<Renderer>().sharedMaterial = shopMat;
                    break;
                case NodeType.Start:
                    Disc(root, specialDiameter * 1.25f, nodeThickness * 0.7f, specialMat, "Ring");
                    Disc(root, specialDiameter, nodeThickness * 1.2f, startMat, "Disc");
                    break;
                case NodeType.Station:
                    // square wooden platform with the stop on it
                    var plat = GameObject.CreatePrimitive(PrimitiveType.Cube);
                    plat.name = "Platform";
                    plat.transform.SetParent(root.transform, false);
                    plat.transform.localScale = new Vector3(nodeDiameter * 1.35f, nodeThickness * 0.7f, nodeDiameter * 1.35f);
                    plat.transform.localPosition = Vector3.up * (nodeThickness * 0.35f + lift);
                    plat.GetComponent<Renderer>().sharedMaterial = stationMat;
                    Disc(root, nodeDiameter * 0.8f, nodeThickness * 1.3f, normalMat, "Disc");
                    break;
                case NodeType.Tunnel:
                    Disc(root, nodeDiameter * 1.1f, nodeThickness, tunnelMat, "Disc");
                    break;
                default:
                    Disc(root, nodeDiameter, nodeThickness, normalMat, "Disc");
                    break;
            }
        }

        GameObject Disc(GameObject parent, float diameter, float height, Material mat, string name)
        {
            var g = GameObject.CreatePrimitive(PrimitiveType.Cylinder);   // 2 units tall, 1 wide
            g.name = name;
            g.transform.SetParent(parent.transform, false);
            g.transform.localScale = new Vector3(diameter, height * 0.5f, diameter);
            g.transform.localPosition = Vector3.up * (height * 0.5f + lift);
            g.GetComponent<Renderer>().sharedMaterial = mat;
            return g;
        }

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

                    var go = new GameObject($"{a.id}-{b.id}");
                    go.transform.SetParent(root.transform, false);
                    go.transform.rotation = Quaternion.Euler(90f, 0f, 0f);   // ribbon lies flat on the ground
                    var lr = go.AddComponent<LineRenderer>();
                    lr.useWorldSpace = true;
                    lr.alignment = LineAlignment.TransformZ;
                    lr.widthMultiplier = edgeWidth;
                    lr.sharedMaterial = edgeMat;
                    lr.shadowCastingMode = ShadowCastingMode.Off;
                    lr.numCapVertices = 2;

                    // follow the dunes: one point per metre, just above the sand
                    Vector3 A = a.transform.position, B = b.transform.position;
                    int seg = Mathf.Max(2, Mathf.CeilToInt(Vector3.Distance(A, B)));
                    var pts = new Vector3[seg + 1];
                    for (int i = 0; i <= seg; i++)
                    {
                        var p = Vector3.Lerp(A, B, i / (float)seg);
                        p.y = GroundY(p) + lift + 0.05f;
                        pts[i] = p;
                    }
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
