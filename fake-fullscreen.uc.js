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

    window.BrowserCommands.fullScreen = function () {
      const root = document.documentElement;
      if (root.getAttribute("data-uc-fakefullscreen") === "true") {
        root.removeAttribute("data-uc-fakefullscreen");
      } else {
        root.setAttribute("data-uc-fakefullscreen", "true");
      }
    };
  }

  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init, { once: true });
  }
})();
