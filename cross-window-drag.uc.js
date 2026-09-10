// Cross-window tab drag reveal
// When you start dragging a tab in this window, mark every OTHER open
// Firefox window's #navigator-toolbox with externaldrag="true" so their
// autohide CSS treats it as a reveal trigger (see userChrome.css, the
// [externaldrag="true"] selectors). Clears the marker on all windows the
// moment the drag ends, is cancelled, or Firefox fails to clean up after
// itself (dragend/drop not firing) - handled with a safety timeout below.

(function () {
  function init() {
    const toolbox = document.getElementById("navigator-toolbox");
    if (!toolbox) return;

    let safetyTimer = null;

    function markOtherWindows(on) {
      const wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(Ci.nsIWindowMediator);
      const windows = wm.getEnumerator("navigator:browser");
      while (windows.hasMoreElements()) {
        const win = windows.getNext();
        if (win === window) continue; // skip the window we're dragging in - it already reveals itself via [movingtab]
        const otherToolbox = win.document.getElementById("navigator-toolbox");
        if (!otherToolbox) continue;
        if (on) {
          otherToolbox.setAttribute("externaldrag", "true");
        } else {
          otherToolbox.removeAttribute("externaldrag");
        }
      }
    }

    const observer = new MutationObserver(() => {
      const isDragging = toolbox.hasAttribute("movingtab");

      if (isDragging) {
        markOtherWindows(true);
        // Safety net: Firefox has a known issue (bug 2061864) where movingtab
        // can get stuck if the platform never delivers a drop/dragend event.
        // Clear everything after 30s regardless, so a stuck drag can't leave
        // every other window permanently revealed.
        if (safetyTimer) clearTimeout(safetyTimer);
        safetyTimer = setTimeout(() => markOtherWindows(false), 30000);
      } else {
        markOtherWindows(false);
        if (safetyTimer) {
          clearTimeout(safetyTimer);
          safetyTimer = null;
        }
      }
    });

    observer.observe(toolbox, { attributes: true, attributeFilter: ["movingtab"] });

    // Clean up if this window closes mid-drag, so it doesn't leave other
    // windows stuck open.
    window.addEventListener("unload", () => {
      observer.disconnect();
      if (safetyTimer) clearTimeout(safetyTimer);
      markOtherWindows(false);
    });
  }

  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init, { once: true });
  }
})();
