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
        Vector3 lastBoardCentre;

        void OnEnable() { cam = GetComponent<Camera>(); lastW = 0; }
        void OnValidate() { lastW = 0; }

        void LateUpdate()
        {
            if (!board) board = FindAnyObjectByType<Board>();
            if (!board || !cam) return;
            var b = BoardBounds();
            if (cam.pixelWidth == lastW && cam.pixelHeight == lastH && b.center == lastBoardCentre) return;
            lastW = cam.pixelWidth; lastH = cam.pixelHeight; lastBoardCentre = b.center;
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

        void Fit(Bounds b)
        {
            var rot = Quaternion.Euler(pitch, yaw, 0f);
            transform.rotation = rot;
            Vector3 aim = b.center + aimOffset;
            Vector3 fwd = rot * Vector3.forward;

            var corners = new Vector3[8];
            for (int i = 0; i < 8; i++)
                corners[i] = new Vector3(
                    (i & 1) == 0 ? b.min.x : b.max.x,
                    (i & 2) == 0 ? b.min.y : b.max.y,
                    (i & 4) == 0 ? b.min.z : b.max.z);

            // binary search the distance where the board just fits inside [margin, 1 - margin]
            float lo = 5f, hi = 2000f;
            for (int k = 0; k < 40; k++)
            {
                float d = (lo + hi) * 0.5f;
                transform.position = aim - fwd * d;
                if (Fits(corners)) hi = d; else lo = d;
            }
            transform.position = aim - fwd * hi;
            if (cam.farClipPlane < hi * 3f) cam.farClipPlane = hi * 3f;
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
