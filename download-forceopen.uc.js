// Download Force-Open
//
// Reveals the toolbar (tabs/nav-bar/bookmarks) for 4 seconds whenever a
// download starts or completes, regardless of where the mouse currently
// is — sets [forceopen] on #navigator-toolbox (see userChrome.css's
// reveal rules for this attribute) and clears it after 4s. Start and
// completion share the same timer: repeated triggers (multiple downloads,
// or a start/finish happening less than 4s apart) reset the countdown
// back to a fresh 4 seconds rather than stacking or extending past it.
// Once the timer runs out, normal mouse-position-based show/hide takes
// back over exactly as before.
//
// Firefox's download list is global across all open windows, not
// per-window — so this script runs independently in every window (like
// the other .uc.js files in this mod) and each window's own instance
// hears about every download directly, with no extra cross-window
// messaging needed.
//
// Which window reacts: the window the download was started in (the one
// containing the page/link that was clicked). Firefox records that page
// on each download as download.source.browsingContextId, which this
// script turns back into a window. If that information isn't available
// for some download, it falls back to whichever window was focused when
// the download started.

(function () {
  // Set to false to stop writing "[download-forceopen]" lines to the
  // Browser Console (Ctrl+Shift+J).
  const DEBUG = true;

  function log(...args) {
    if (DEBUG) console.log("[download-forceopen]", ...args);
  }

  // Works out which window a download started in. Every window's copy of
  // this script runs this same logic separately, so they all reach the
  // same answer without needing to talk to each other.
  function findOriginWindow(download) {
    try {
      const id = download.source && download.source.browsingContextId;
      if (id) {
        const bc = BrowsingContext.get(id);
        const browserEl = bc && bc.top && bc.top.embedderElement;
        const win = browserEl && browserEl.ownerGlobal;
        if (win && !win.closed) {
          return { win, how: "browsingContextId" };
        }
      }
    } catch (ex) {
      console.error("[download-forceopen] Failed to resolve origin window", ex);
    }
    return { win: Services.wm.getMostRecentBrowserWindow(), how: "focused-window fallback" };
  }

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

    // download -> the window it started in, decided once when the
    // download is first seen (that's when the originating page is most
    // reliably still known).
    const originOf = new WeakMap();

    function decideOrigin(download) {
      if (!originOf.has(download)) {
        const result = findOriginWindow(download);
        originOf.set(download, result.win);
        log("download started; origin decided by", result.how,
            "- this window is the origin:", result.win === window);
      }
      return originOf.get(download);
    }

    // True if this window is the one that should react to this download.
    // If the origin window was closed since the download started, the
    // currently focused window reacts instead so the user still sees it.
    function isThisTheTargetWindow(download) {
      const origin = decideOrigin(download);
      if (origin && !origin.closed) return origin === window;
      return Services.wm.getMostRecentBrowserWindow() === window;
    }

    const view = {
      onDownloadAdded(download) {
        if (!isThisTheTargetWindow(download)) return;
        forceStayOpenFor(4000);
      },
      onDownloadChanged(download) {
        if (download.succeeded && !completedAlready.has(download)) {
          completedAlready.add(download);
          if (!isThisTheTargetWindow(download)) return;
          log("download finished; revealing toolbars in the origin window");
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
