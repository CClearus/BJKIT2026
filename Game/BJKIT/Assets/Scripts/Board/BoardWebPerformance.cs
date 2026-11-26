using UnityEngine;
using UnityEngine.Scripting;

namespace BJKIT.BoardGame
{
    /// Web build only (nothing changes in the editor):
    ///
    /// 1. Frame pacing. A WebGL build normally draws at the screen's full refresh rate (60, or 120-144 on
    ///    gaming laptops), which makes the page around it lag. Application.targetFrameRate is NOT used:
    ///    in a browser it runs frames from a timer, which felt uneven ("laggier"). Instead Unity draws on
    ///    every Nth display refresh (QualitySettings.vSyncCount = swap interval), so frames stay evenly
    ///    spaced. Default: every 2nd refresh (30 fps on 60 Hz). From the page:
    ///      boardGame.SendMessage('BoardWeb', 'SetSwapInterval', 1)   // 1 = every refresh ... 4
    ///    (The page also adapts the board's resolution and pauses Unity while a mission is open.)
    ///
    /// 2. See-through sky. The camera clears to transparent instead of drawing the sky, so the website's
    ///    own map background shows behind the board. Needs "Alpha Processing" on in the URP asset
    ///    (WebBuild turns it on before building) and a page canvas with alpha (Unity's default).
    ///    The sky material stays as RenderSettings.skybox, so reflections and lighting don't change.
    public class BoardWebPerformance : MonoBehaviour
    {
        public const int DefaultSwapInterval = 2;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Init()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            Application.targetFrameRate = -1;
            QualitySettings.vSyncCount = DefaultSwapInterval;
            var go = new GameObject("BoardWeb");   // SendMessage target, keep this name
            DontDestroyOnLoad(go);
            go.AddComponent<BoardWebPerformance>();
#endif
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void SeeThroughSky()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            foreach (var cam in Camera.allCameras)
            {
                cam.clearFlags = CameraClearFlags.SolidColor;
                cam.backgroundColor = new Color(0f, 0f, 0f, 0f);
                var sky = cam.GetComponent<Skybox>();
                if (sky) sky.enabled = false;
                // Anti-aliasing stays SMAA (sharper than FXAA; FXAA made the board look soft). The camera
                // view is filled by the ground and rock wall, so no sky shows for SMAA's alpha to matter.
            }
#endif
        }

        [Preserve]
        public void SetSwapInterval(int interval)
        {
            Application.targetFrameRate = -1;
            QualitySettings.vSyncCount = Mathf.Clamp(interval, 1, 4);
        }

        // Older page code may still call this: maps a frame rate to the nearest swap interval at 60 Hz.
        [Preserve]
        public void SetFrameRate(int fps)
        {
            SetSwapInterval(fps <= 0 ? 1 : Mathf.RoundToInt(60f / Mathf.Clamp(fps, 15, 60)));
        }
    }
}
