// New Tab - Don't Auto-Focus the Address Bar
//
// Firefox automatically puts keyboard focus into the address bar (and
// selects its text) whenever a new tab opens to about:newtab/about:blank/
// about:home - handy for immediately typing a URL, but not wanted here.
// This lets a new tab open normally without stealing focus into the
// address bar - the cursor just doesn't start out blinking there.
//
// How: a brief "expecting Firefox's own auto-focus" flag is armed the
// moment a new about:newtab/about:blank/about:home tab is created
// (TabOpen). The very next time the address bar's input actually
// receives focus while that flag is armed, it's immediately blurred and
// focus is handed to the page content instead - Firefox's own new-tab
// focus call happens synchronously as part of opening the tab, so this
// reliably catches exactly that one call and nothing else. The flag is
// disarmed immediately after catching it (so a later, genuine click into
// the address bar is never intercepted) and also expires on its own
// after a short safety window, in case Firefox's focus call doesn't
// happen the way this expects it to.

(function () {
  function init() {
    if (!window.gBrowser || !window.gURLBar || !window.gURLBar.inputField) {
      setTimeout(init, 200);
      return;
    }

    const NEW_TAB_URLS = new Set(["about:newtab", "about:blank", "about:home"]);
    let armed = false;
    let armTimer = null;

    gBrowser.tabContainer.addEventListener("TabOpen", (event) => {
      const tab = event.target;
      const browser = tab && tab.linkedBrowser;
      const uri = browser && browser.currentURI && browser.currentURI.spec;
      if (!NEW_TAB_URLS.has(uri)) return;

      armed = true;
      if (armTimer) clearTimeout(armTimer);
      armTimer = setTimeout(() => {
        armed = false;
        armTimer = null;
      }, 300);
    });

    gURLBar.inputField.addEventListener("focus", () => {
      if (!armed) return;
      armed = false;
      if (armTimer) {
        clearTimeout(armTimer);
        armTimer = null;
      }
      gURLBar.inputField.blur();
      try {
        gBrowser.selectedBrowser.focus();
      } catch (ex) {
        console.error(
          "[no-newtab-urlbar-focus] Failed to focus content after suppressing address bar auto-focus",
          ex
        );
      }
    });
  }

  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init, { once: true });
  }
})();
