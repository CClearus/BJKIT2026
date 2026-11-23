using System.Collections;
using System.Runtime.InteropServices;
using UnityEngine;
using UnityEngine.Rendering;

namespace BJKIT.BoardGame
{
    /// Tells the camp website when the board is really on screen: after the "Made with Unity" splash
    /// has faded out. The page keeps its GIF loading screen up until then (window.BoardPage.ready()).
    public class BoardPageSignal : MonoBehaviour
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern void BoardPageReady();   // Plugins/WebGL/BoardBridge.jslib
#else
        static void BoardPageReady() { }
#endif

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Init()
        {
            var go = new GameObject(nameof(BoardPageSignal));
            go.hideFlags = HideFlags.HideAndDontSave;
            DontDestroyOnLoad(go);
            go.AddComponent<BoardPageSignal>();
        }

        IEnumerator Start()
        {
            while (!SplashScreen.isFinished) yield return null;
            yield return null;   // let the real scene draw a couple of frames first
            yield return null;
            BoardPageReady();
            Destroy(gameObject);
        }
    }
}
