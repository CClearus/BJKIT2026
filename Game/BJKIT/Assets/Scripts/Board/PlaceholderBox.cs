using UnityEngine;

namespace BJKIT.BoardGame
{
    /// A landmark that has no model yet: an empty object with a BoxCollider of the right size.
    /// Drop the real model in as a child (or replace the object) and delete this component.
    /// Editor only: draws the box and its name so it can be seen in the Scene view (nothing renders in the game).
    [RequireComponent(typeof(BoxCollider))]
    public class PlaceholderBox : MonoBehaviour
    {
        [TextArea] public string note;
        public Color color = new Color(1f, 0.45f, 0.1f, 1f);

#if UNITY_EDITOR
        void OnDrawGizmos()
        {
            var box = GetComponent<BoxCollider>();
            if (!box) return;
            Gizmos.matrix = transform.localToWorldMatrix;
            Gizmos.color = new Color(color.r, color.g, color.b, 0.12f);
            Gizmos.DrawCube(box.center, box.size);
            Gizmos.color = color;
            Gizmos.DrawWireCube(box.center, box.size);
            Gizmos.matrix = Matrix4x4.identity;
            UnityEditor.Handles.Label(transform.TransformPoint(box.center + Vector3.up * (box.size.y * 0.5f + 1f)), name);
        }
#endif
    }
}
