// Calls into the camp website (public/index.html) from the Unity web build.
mergeInto(LibraryManager.library, {
  // The board is really on screen ("Made with Unity" splash faded out): the page hides its GIF loading screen.
  BoardPageReady: function () {
    if (typeof window !== 'undefined' && window.BoardPage && window.BoardPage.ready) window.BoardPage.ready();
  },
});
