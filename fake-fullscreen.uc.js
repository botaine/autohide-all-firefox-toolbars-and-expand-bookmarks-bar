// Fake Fullscreen (push-down toggle only)
//
// Repurposes Firefox's own "Full Screen" command (the F11 key, and the
// View > Full Screen menu item) so it no longer triggers Firefox's real,
// OS-level fullscreen - which hides the window's titlebar/chrome and
// takes over the whole screen. The window itself is left completely
// alone: same size, same maximized/restored state, same everything.
//
// Instead, the command just flips a plain attribute on the root
// element - data-uc-fakefullscreen="true" - which userChrome.css's
// fullscreen push-down override (section 1b) reads instead of (well,
// in addition to) the real :root[sizemode="fullscreen"] Firefox would
// otherwise set. So "turning on fullscreen mode" now does exactly one
// thing: the toolbars start pushing the page down when they reveal,
// instead of overlaying on top of it. Turning it off removes the
// attribute and the toolbars go back to overlaying, same as normal
// windowed mode always has.
//
// This works by intercepting BrowserCommands.fullScreen() - the single
// function Firefox itself calls for the F11 key, the menu item, and any
// other built-in trigger of the fullscreen command - so every normal
// way of "entering fullscreen" is covered without needing separate key
// or menu bindings of our own. window.fullScreen (the real native
// toggle) is deliberately never touched, which is what keeps the actual
// OS-level fullscreen transition from ever happening.
//
// Isolating this from a page's OWN fullscreen (e.g. fullscreening a
// YouTube video) is handled below. A page's own fullscreen still has to
// take the real, OS-level window fullscreen while it's active - that's
// how the standard Fullscreen API works in every browser and isn't
// something this script prevents or should prevent, since the video
// still needs to actually go fullscreen normally. Firefox marks that
// with inDOMFullscreen="true" on :root (see userChrome.css's own
// section 1c, which uses the same attribute to fully hide this mod's
// toolbar while it's active, instead of drawing over the video).
//
// What this script guards against is that round-trip leaving anything
// behind once it's over: this mod's own data-uc-fakefullscreen
// attribute is snapshotted the instant a page's fullscreen begins and
// force-restored to that exact snapshot the instant it ends, regardless
// of anything that happens to it in between - and if the real
// fullscreen transition left a toolbar element (the address bar, a
// button, etc.) focused, which would otherwise keep this mod's toolbar
// forced open indefinitely via its own :focus-within reveal trigger
// (nothing about that transition reliably fires a normal blur the way
// an actual mouse click elsewhere would), that focus is explicitly
// handed back to the page - exactly like exiting fullscreen already
// does in stock, unmodified Firefox. Net effect: fullscreening a video
// and exiting it again leaves this mod's fullscreen-mode toggle and
// toolbar-hide behavior exactly as they were beforehand, every time.
//
// The native Full Screen command/toolbar button's own "checked"
// (highlighted) appearance is Firefox's own doing, driven entirely by
// the real window.fullScreen value - which this mod's toggle
// deliberately never touches, and which a page's own fullscreen (e.g.
// a video) DOES briefly touch for real. Left alone, that means the
// button would only ever highlight during a page's own fullscreen,
// never for this mod's own fullscreen mode, and would un-highlight the
// moment a page's fullscreen ends even while this mod's fullscreen
// mode is still on - backwards from what it should show. syncButton()
// below explicitly drives the button/command's checked attribute from
// this mod's own data-uc-fakefullscreen attribute instead, so the
// indicator always matches this mod's fullscreen mode, not the
// page-fullscreen transition riding along underneath it.

(function () {
  function init() {
    if (
      !window.BrowserCommands ||
      typeof window.BrowserCommands.fullScreen !== "function"
    ) {
      // browser.js hasn't finished defining BrowserCommands yet on this
      // window - try again shortly rather than failing silently.
      setTimeout(init, 200);
      return;
    }

    const root = document.documentElement;

    function syncButton(on) {
      const command = document.getElementById("View:FullScreen");
      if (command) {
        if (on) {
          command.setAttribute("checked", "true");
        } else {
          command.removeAttribute("checked");
        }
      }
      const button = document.getElementById("fullscreen-button");
      if (button) {
        if (on) {
          button.setAttribute("checked", "true");
        } else {
          button.removeAttribute("checked");
        }
      }
    }

    window.BrowserCommands.fullScreen = function () {
      let on;
      if (root.getAttribute("data-uc-fakefullscreen") === "true") {
        root.removeAttribute("data-uc-fakefullscreen");
        on = false;
      } else {
        root.setAttribute("data-uc-fakefullscreen", "true");
        on = true;
      }
      syncButton(on);
    };

    // --- Isolate this mod's fullscreen-mode toggle from a page's own
    // (e.g. a YouTube video's) fullscreen - see the comment above. ---
    let savedFakeFullscreen = null; // null = not currently inside a page fullscreen

    const domFullscreenObserver = new MutationObserver(() => {
      const inDomFullscreen = root.getAttribute("inDOMFullscreen") === "true";

      if (inDomFullscreen) {
        // Take the snapshot only once, right as the page's fullscreen
        // starts - a later, unrelated mutation while still in it (there
        // shouldn't be one, but just in case) must not overwrite it.
        if (savedFakeFullscreen === null) {
          savedFakeFullscreen =
            root.getAttribute("data-uc-fakefullscreen") === "true";
        }
        return;
      }

      if (savedFakeFullscreen === null) return; // nothing pending to restore
      const shouldBeOn = savedFakeFullscreen;
      savedFakeFullscreen = null;

      if (shouldBeOn) {
        root.setAttribute("data-uc-fakefullscreen", "true");
      } else {
        root.removeAttribute("data-uc-fakefullscreen");
      }

      // Re-drive the button/command's checked state from this mod's
      // own (just-restored) attribute, not the page-fullscreen exit.
      // Firefox's own native handling of the real window.fullScreen
      // change this exact moment (the page fullscreen ending) sets
      // this same checked attribute from ITS side too, so this is
      // deferred a beat to make sure it runs after that and wins,
      // rather than racing it and losing.
      syncButton(shouldBeOn);
      setTimeout(() => syncButton(shouldBeOn), 0);

      // If focus ended up stuck on a toolbar element, hand it back to
      // the page so this mod's :focus-within reveal trigger can't keep
      // the toolbar forced open with no way for the user to clear it.
      const toolbox = document.getElementById("navigator-toolbox");
      if (
        toolbox &&
        document.activeElement &&
        toolbox.contains(document.activeElement)
      ) {
        document.activeElement.blur();
        try {
          gBrowser.selectedBrowser.focus();
        } catch (ex) {
          console.error("[fake-fullscreen] Failed to refocus content after page fullscreen exit", ex);
        }
      }
    });

    domFullscreenObserver.observe(root, {
      attributes: true,
      attributeFilter: ["inDOMFullscreen"],
    });

    window.addEventListener(
      "unload",
      () => domFullscreenObserver.disconnect(),
      { once: true }
    );
  }

  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init, { once: true });
  }
})();
