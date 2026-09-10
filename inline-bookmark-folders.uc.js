// Inline Bookmark Folder Expansion
//
// Replaces the native vertical dropdown for bookmarks-toolbar folders with
// inline expansion: clicking a folder inserts its contents directly into
// the toolbar's own flex-wrap row (right after the folder button), letting
// the existing multi-row_bookmarks.css flex-wrap layout handle wrapping
// into new rows automatically. Clicking the folder again collapses it.
// Nested folders (inside an expanded folder) work the same way, and
// multiple folders can be expanded at once.
//
// KNOWN RISK AREAS (most likely places we'll need to debug against real
// bookmarks, since these are the two Places/Firefox APIs this script
// depends on that we haven't verified against a live browser yet):
//   1. PlacesUtils.promiseBookmarksTree() - fetching a folder's children.
//      If property names differ from what's expected (e.g. `.uri` vs
//      `.url`), children may fail to load or show blank titles/links.
//   2. loadURI() - opening a bookmark's URL when a leaf item is clicked.
// Both log clear console.error messages on failure so problems are
// visible rather than silently doing nothing.

(function () {
  function init() {
    const placesToolbarItems = document.getElementById("PlacesToolbarItems");
    if (!placesToolbarItems) return;

    // Marks a bookmark-item toolbarbutton as one WE injected (as opposed to
    // a native one Firefox created), and records which folder guid "owns"
    // it, so we know what to remove on collapse.
    const OWNER_ATTR = "data-bmif-owner";
    const EXPANDED_ATTR = "data-bmif-expanded";

    function isFolderButton(el) {
      return (
        el &&
        el.classList &&
        el.classList.contains("bookmark-item") &&
        el.getAttribute("type") === "menu" &&
        el.hasAttribute("container") // Firefox marks folder bookmark-items with a "container" attribute in the toolbar; only intercept these, not plain link bookmarks that also happen to be type="menu" for some other reason
      );
    }

    function getFolderGuid(el) {
      // Native toolbar bookmark items expose their bookmark's guid via this
      // property (set by Firefox's own PlacesUIUtils toolbar-building code).
      return el._placesNode ? el._placesNode.bookmarkGuid : el.getAttribute("data-bmif-guid");
    }

    async function fetchChildren(guid) {
      try {
        const tree = await PlacesUtils.promiseBookmarksTree(guid, {
          includeItemIds: false,
        });
        return tree && tree.children ? tree.children : [];
      } catch (ex) {
        console.error("[inline-bookmark-folders] Failed to fetch children for", guid, ex);
        return [];
      }
    }

    function makeFaviconUrl(url) {
      try {
        return "page-icon:" + url;
      } catch (ex) {
        return "";
      }
    }

    function buildItemElement(node, ownerGuid) {
      const btn = document.createXULElement
        ? document.createXULElement("toolbarbutton")
        : document.createElement("toolbarbutton");

      btn.classList.add("bookmark-item");
      btn.setAttribute("label", node.title || "");
      btn.setAttribute(OWNER_ATTR, ownerGuid);
      btn.setAttribute("data-bmif-guid", node.guid);

      const isFolder = node.type === "text/x-moz-place-container" || node.children !== undefined;

      if (isFolder) {
        btn.setAttribute("type", "menu");
        btn.setAttribute("container", "true");
      } else {
        const url = node.uri || node.url || "";
        btn.setAttribute("image", makeFaviconUrl(url));
        btn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          openBookmarkUrl(url, event);
        });
      }

      return btn;
    }

    function openBookmarkUrl(url, event) {
      if (!url) return;
      try {
        const where = event.button === 1 || event.ctrlKey || event.metaKey ? "tab" : "current";
        window.openTrustedLinkIn(url, where);
      } catch (ex) {
        console.error("[inline-bookmark-folders] Failed to open URL", url, ex);
      }
    }

    function collapseFolder(guid) {
      const owned = placesToolbarItems.querySelectorAll(
        `[${OWNER_ATTR}="${CSS.escape(guid)}"]`
      );
      owned.forEach((el) => {
        // If this owned element is itself an expanded folder, collapse it
        // first so its own children get cleaned up too.
        if (el.getAttribute(EXPANDED_ATTR) === "true") {
          collapseFolder(el.getAttribute("data-bmif-guid"));
        }
        el.remove();
      });
    }

    async function expandFolder(folderButton, guid) {
      const children = await fetchChildren(guid);
      let insertAfter = folderButton;
      for (const child of children) {
        const el = buildItemElement(child, guid);
        insertAfter.after(el);
        insertAfter = el;
        // Wire up nested-folder clicks the same way as top-level ones —
        // mousedown, for the same reason noted on the delegated listener
        // above (native folder popups open on mousedown, not click).
        if (el.getAttribute("type") === "menu") {
          el.addEventListener("mousedown", handleFolderClick, true);
        }
      }
      folderButton.setAttribute(EXPANDED_ATTR, "true");
    }

    function handleFolderClick(event) {
      const target = event.target.closest
        ? event.target.closest("toolbarbutton")
        : event.target;
      if (!isFolderButton(target)) return;

      event.preventDefault();
      event.stopPropagation();

      const guid = getFolderGuid(target);
      if (!guid) {
        console.error("[inline-bookmark-folders] Could not determine guid for folder", target);
        return;
      }

      if (target.getAttribute(EXPANDED_ATTR) === "true") {
        collapseFolder(guid);
        target.removeAttribute(EXPANDED_ATTR);
      } else {
        expandFolder(target, guid);
      }
    }

    // Capture-phase listener on the toolbar container catches presses on
    // both native folder buttons and any we inject later (event
    // delegation). This runs on "mousedown" rather than "click" because
    // Firefox's native type="menu" toolbarbuttons open their popup on
    // mousedown, not on click — a click-based listener runs too late to
    // block it, which is why the native dropdown was appearing alongside
    // our inline expansion.
    placesToolbarItems.addEventListener("mousedown", handleFolderClick, true);

    // Collapse all expanded folders when the toolbar itself auto-hides
    // (mouse moves away and the reveal delay elapses), so folders don't
    // stay expanded from a previous visit the next time the bar reopens.
    // Reads the delay directly from the CSS custom property rather than
    // hardcoding it, so it can never drift out of sync with userChrome.css
    // if that value is changed later.
    const navigatorToolbox = document.getElementById("navigator-toolbox");
    let collapseAllTimer = null;

    function collapseAllFolders() {
      const expanded = placesToolbarItems.querySelectorAll(`[${EXPANDED_ATTR}="true"]`);
      expanded.forEach((folderButton) => {
        // Skip any that are themselves owned by another still-expanded
        // folder — collapsing the outermost one already recursively
        // removes its nested children via collapseFolder().
        if (folderButton.closest(`[${OWNER_ATTR}]`)) return;
        const guid = getFolderGuid(folderButton);
        collapseFolder(guid);
        folderButton.removeAttribute(EXPANDED_ATTR);
      });
    }

    if (navigatorToolbox) {
      navigatorToolbox.addEventListener("mouseleave", () => {
        if (collapseAllTimer) clearTimeout(collapseAllTimer);
        const delayStr = getComputedStyle(navigatorToolbox).getPropertyValue(
          "--uc-autohide-toolbar-delay"
        );
        const delayMs = parseFloat(delayStr) || 0;
        collapseAllTimer = setTimeout(() => {
          // Guard: if something else (focus-within, an open menu, a drag,
          // etc.) is still legitimately keeping the toolbar open despite
          // the mouse having left, don't collapse folders out from under
          // the user.
          if (navigatorToolbox.matches(":hover, :focus-within")) return;
          collapseAllFolders();
        }, delayMs);
      });

      navigatorToolbox.addEventListener("mouseenter", () => {
        if (collapseAllTimer) {
          clearTimeout(collapseAllTimer);
          collapseAllTimer = null;
        }
      });
    }
  }

  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init, { once: true });
  }
})();