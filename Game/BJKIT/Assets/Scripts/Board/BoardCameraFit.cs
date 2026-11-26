using System.Collections.Generic;
using UnityEngine;

namespace BJKIT.BoardGame
{
    /// Bird's-eye camera that always shows the whole board, whatever shape the web page gives it
    /// (the map area left of the Missions panel changes with the window and panel width).
    /// Keeps the tilt/heading and moves the camera in or out until every node fits with a margin.
    [ExecuteAlways]
    [RequireComponent(typeof(Camera))]
    public class BoardCameraFit : MonoBehaviour
    {
        public Board board;
        [Range(20f, 89f)] public float pitch = 45f;        // 90 = straight down
        public float yaw = 180f;                           // looks from +Z toward -Z (sketch layout)
        [Tooltip("Empty space around the board, as a share of the view on each side.")]
        [Range(0f, 0.3f)] public float margin = 0.04f;
        [Tooltip("Shift the aim point (world metres), e.g. push the board down a bit to show more cliffs above it.")]
        public Vector3 aimOffset = Vector3.zero;

        Camera cam;
        int lastW, lastH;
        Vector3 lastBoardCentre, lastBoardSize;

        void OnEnable() { cam = GetComponent<Camera>(); lastW = 0; }
        void OnValidate() { lastW = 0; }

        /// Fit again on the next frame (e.g. after Tools > Board > Spread Board).
        public void Refit() { lastW = 0; }

        /// Fit right now, as if the view had this aspect (width / height); used by editor tools that need
        /// the camera position immediately (Spread Board sizes the terrain from what the camera sees).
        public void FitNow(float aspect)
        {
            if (!cam) cam = GetComponent<Camera>();
            if (!board) board = FindAnyObjectByType<Board>();
            if (!board || !cam) return;
            cam.aspect = aspect;
            Fit(BoardBounds());
            cam.ResetAspect();
            lastW = 0;
        }

        void LateUpdate()
        {
            if (!board) board = FindAnyObjectByType<Board>();
            if (!board || !cam) return;
            var b = BoardBounds();
            if (cam.pixelWidth == lastW && cam.pixelHeight == lastH && b.center == lastBoardCentre && b.size == lastBoardSize) return;
            lastW = cam.pixelWidth; lastH = cam.pixelHeight; lastBoardCentre = b.center; lastBoardSize = b.size;
            Fit(b);
        }

        Bounds BoardBounds()
        {
            bool any = false;
            var b = new Bounds();
            float r = Mathf.Max(board.nodeDiameter, board.specialDiameter) * 0.7f;
            foreach (var n in board.Nodes)
            {
                var p = n.transform.position;
                var nb = new Bounds(p + Vector3.up * 1f, new Vector3(r * 2f, 2f, r * 2f));
                if (!any) { b = nb; any = true; } else b.Encapsulate(nb);
            }
            return b;
        }

        // The points that must be on screen: around every node (not the corners of the board's bounding box:
        // at a 45° tilt the empty front corners of that box pushed the camera much further back than needed).
        Vector3[] FitPoints()
        {
            float r = Mathf.Max(board.nodeDiameter, board.specialDiameter) * 0.7f;
            var pts = new List<Vector3>();
            foreach (var n in board.Nodes)
            {
                var p = n.transform.position;
                pts.Add(p + new Vector3(-r, 0f, -r)); pts.Add(p + new Vector3(r, 0f, -r));
                pts.Add(p + new Vector3(-r, 0f, r)); pts.Add(p + new Vector3(r, 2f, r));
            }
            return pts.ToArray();
        }

        void Fit(Bounds b)
        {
            var rot = Quaternion.Euler(pitch, yaw, 0f);
            transform.rotation = rot;
            Vector3 fwd = rot * Vector3.forward;
            Vector3 right = rot * Vector3.right;
            Vector3 groundUp = Vector3.ProjectOnPlane(rot * Vector3.up, Vector3.up).normalized;   // "up the screen" on the ground
            var pts = FitPoints();
            Vector3 aim = b.center;

            // fit the distance, then nudge the aim so the nodes sit centred on screen; a few rounds settle it
            float dist = 100f;
            for (int round = 0; round < 4; round++)
            {
                dist = FitDistance(aim + aimOffset, fwd, pts);
                float x0 = 1f, x1 = 0f, y0 = 1f, y1 = 0f;
                foreach (var p in pts)
                {
                    var v = cam.WorldToViewportPoint(p);
                    x0 = Mathf.Min(x0, v.x); x1 = Mathf.Max(x1, v.x); y0 = Mathf.Min(y0, v.y); y1 = Mathf.Max(y1, v.y);
                }
                float h = 2f * dist * Mathf.Tan(cam.fieldOfView * 0.5f * Mathf.Deg2Rad);   // view height at the aim
                aim += right * ((x0 + x1) * 0.5f - 0.5f) * h * cam.aspect
                     + groundUp * ((y0 + y1) * 0.5f - 0.5f) * h / Mathf.Max(0.2f, Mathf.Sin(pitch * Mathf.Deg2Rad));
            }
            dist = FitDistance(aim + aimOffset, fwd, pts);
            transform.position = aim + aimOffset - fwd * dist;
            if (cam.farClipPlane < dist * 4f) cam.farClipPlane = dist * 4f;
        }

        // binary search the distance where every point just fits inside [margin, 1 - margin]
        float FitDistance(Vector3 aim, Vector3 fwd, Vector3[] pts)
        {
            float lo = 5f, hi = 2000f;
            for (int k = 0; k < 40; k++)
            {
                float d = (lo + hi) * 0.5f;
                transform.position = aim - fwd * d;
                if (Fits(pts)) hi = d; else lo = d;
            }
            transform.position = aim - fwd * hi;
            return hi;
        }

        bool Fits(Vector3[] corners)
        {
            foreach (var c in corners)
            {
                var v = cam.WorldToViewportPoint(c);
                if (v.z <= cam.nearClipPlane) return false;
                if (v.x < margin || v.x > 1f - margin || v.y < margin || v.y > 1f - margin) return false;
            }
            return true;
        }
    }
}
