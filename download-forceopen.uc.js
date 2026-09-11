// Download Force-Open
//
// Reveals the toolbar (tabs/nav-bar/bookmarks) for 3 seconds whenever a
// download starts or completes, regardless of where the mouse currently
// is — sets [forceopen] on #navigator-toolbox (see userChrome.css's
// reveal rules for this attribute) and clears it after 3s. Start and
// completion share the same timer: repeated triggers (multiple downloads,
// or a start/finish happening less than 3s apart) reset the countdown
// back to a fresh 3 seconds rather than stacking or extending past it.
// Once the timer runs out, normal mouse-position-based show/hide takes
// back over exactly as before.
//
// Firefox's download list is global across all open windows, not
// per-window — so this script runs independently in every window (like
// the other .uc.js files in this mod) and each window's own instance
// hears about every download directly, with no extra cross-window
// messaging needed.

(function () {
  function init() {
    const navigatorToolbox = document.getElementById("navigator-toolbox");
    if (!navigatorToolbox) return;

    let forceOpenTimer = null;

    function forceStayOpenFor(ms) {
      if (forceOpenTimer) clearTimeout(forceOpenTimer);
      navigatorToolbox.setAttribute("forceopen", "true");
      forceOpenTimer = setTimeout(() => {
        navigatorToolbox.removeAttribute("forceopen");
        forceOpenTimer = null;
      }, ms);
    }

    // Tracks which downloads we've already reacted to completing, so a
    // download's later, unrelated property changes (Firefox fires
    // onDownloadChanged very frequently — on every progress update, not
    // just at completion) don't keep re-triggering the timer.
    const completedAlready = new WeakSet();

    // Firefox's download list is global, not per-window — every open
    // window's copy of this script hears about every download. To only
    // reveal the window the download actually happened on, each window
    // checks whether IT is currently the focused/active browser window
    // before reacting. (Firefox's public Downloads API doesn't expose
    // which window originated a given download, so "the window that was
    // focused at the moment this fired" is used as a close, reliable
    // stand-in rather than exact origin tracking.)
    function isThisWindowFocused() {
      return Services.wm.getMostRecentBrowserWindow() === window;
    }

    const view = {
      onDownloadAdded(download) {
        if (!isThisWindowFocused()) return;
        forceStayOpenFor(4000);
      },
      onDownloadChanged(download) {
        if (download.succeeded && !completedAlready.has(download)) {
          completedAlready.add(download);
          if (!isThisWindowFocused()) return;
          forceStayOpenFor(4000);
          // Firefox's own DownloadsPanel only auto-shows itself the FIRST
          // time in a session (tracked internally via panelHasShownBefore);
          // later completions only trigger a lighter toolbar-button flash
          // instead of reopening the full panel. Calling showPanel()
          // directly here forces it open again on every completion.
          try {
            if (typeof DownloadsPanel !== "undefined") {
              DownloadsPanel.showPanel();
            }
          } catch (ex) {
            console.error("[download-forceopen] Failed to show downloads panel", ex);
          }
        }
      },
    };

    let downloadList = null;

    try {
      const { Downloads } = ChromeUtils.importESModule(
        "resource://gre/modules/Downloads.sys.mjs"
      );
      Downloads.getList(Downloads.ALL)
        .then((list) => {
          downloadList = list;
          return list.addView(view);
        })
        .catch((ex) => {
          console.error("[download-forceopen] Failed to attach to download list", ex);
        });
    } catch (ex) {
      console.error("[download-forceopen] Failed to import Downloads module", ex);
    }

    window.addEventListener("unload", () => {
      if (forceOpenTimer) clearTimeout(forceOpenTimer);
      if (downloadList) downloadList.removeView(view);
    });
  }

  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init, { once: true });
  }
})();