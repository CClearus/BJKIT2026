using System;
using UnityEngine;

namespace BJKIT.BoardGame
{
    /// The board runs inside the camp website (public/index.html). By default a Unity web build grabs
    /// every key press on the page; the board needs no keyboard, so leave the keys to the website.
    /// (WebGLInput lives in the WebGL module, which scripts can't reference in this project, so it is set by reflection.)
    public static class WebPageFriendly
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Init()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            var t = Type.GetType("UnityEngine.WebGLInput, UnityEngine.WebGLModule");
            var p = t != null ? t.GetProperty("captureAllKeyboardInput") : null;
            if (p != null) p.SetValue(null, false);
#endif
        }
    }
}
