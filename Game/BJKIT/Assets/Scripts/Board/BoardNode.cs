using System.Collections.Generic;
using UnityEngine;

namespace BJKIT.BoardGame
{
    // (new types go at the end: scenes store the number)
    public enum NodeType
    {
        Normal,   // navy: nothing happens
        Special,  // yellow: special question (the clan must solve it on the camp site)
        Event,    // navy with yellow ring: random event
        Shop,     // yellow diamond: spend money
        Start,    // where every clan begins (the saloon)
        Station,  // railway: ending a move here lets the clan ride to another station (railLinks)
        Tunnel,   // light blue: a mouth of the mine tunnel through the big mesa (an ordinary link joins the pair)
    }

    /// One stop on the board. Links are two-way; Board.Link keeps both sides in sync.
    /// Drag a node in the Scene view and its lines follow (Board.liveEdit).
    public class BoardNode : MonoBehaviour
    {
        [Tooltip("Stable id, also used by the camp server (data/board.json).")]
        public string id;
        public NodeType type = NodeType.Normal;
        [Tooltip("Name shown to players for landmark nodes (specials, stations…). Empty for ordinary nodes.")]
        public string label;
        public List<BoardNode> links = new List<BoardNode>();
        [Tooltip("Stations only: where the train from here can go (a ride, not a walk).")]
        public List<BoardNode> railLinks = new List<BoardNode>();

        public bool IsDeadEnd => links.Count == 1;
        public bool IsJunction => links.Count >= 3;

        void OnDrawGizmosSelected()
        {
            Gizmos.color = Color.cyan;
            foreach (var l in links)
                if (l) Gizmos.DrawLine(transform.position + Vector3.up * 2f, l.transform.position + Vector3.up * 2f);
            Gizmos.color = new Color(0.6f, 0.35f, 0.1f);
            foreach (var r in railLinks)
                if (r) Gizmos.DrawLine(transform.position + Vector3.up * 6f, r.transform.position + Vector3.up * 6f);
        }
    }
}
