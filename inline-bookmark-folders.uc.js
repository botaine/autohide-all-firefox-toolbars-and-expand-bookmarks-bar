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
// Every Places API call in this file is wrapped in try/catch with a
// console.error on failure, so problems are visible in the Browser
// Console rather than silently doing nothing.
//
// Sections in this file (in order):
//   1. Folder expand/collapse - core inline expansion, "Other Bookmarks"
//      relocation, and building the synthetic bookmark/folder/separator
//      elements an expanded folder's contents are made of
//   2. Within-folder drag reordering - native HTML5 drag-and-drop,
//      scoped to bookmarks moving within the folder they're already in
//   3. Custom right-click menu - Open/Edit/Delete/Add/etc. for items
//      inside an expanded folder, plus the Bookmarks Toolbar visibility
//      and Show Other Bookmarks / Manage Bookmarks items
//   4. Folder click/collapse wiring - splits mousedown (blocks the
//      native popup) from click (does the actual toggle), and
//      auto-collapses expanded folders when the toolbar auto-hides
//   5. Manual folder dragging - folders can't use native HTML5 drag (see
//      the comment above MANUAL_DRAG_THRESHOLD for why), so this is a
//      hand-tracked mousedown/mousemove/mouseup drag instead, with its
//      own forbidden-cursor feedback for invalid drop positions
//   6. Native folder-icon drop blocking - stops a dragged bookmark from
//      being silently filed into a NATIVE top-level folder by Firefox's
//      own default handling, without blocking a drop just beside one
//   7. Multi-row bookmarks bar drop-indicator fix - patches in the
//      vertical offset Firefox's own drop indicator never sets itself
//   8. Bookmarks-button menu integration - keeps the toolbar open while
//      any of Firefox's own Bookmarks-menu popups (or a drag within
//      them) are active, and fixes a stray leading separator in
//      Firefox's native right-click menu for a separator item

(function () {
  function init() {
    const placesToolbarItems = document.getElementById("PlacesToolbarItems");
    if (!placesToolbarItems) return;

    // "Other Bookmarks" normally sits as a separate sibling element
    // outside #PlacesToolbarItems entirely (not a participant in its
    // flex-wrap row layout), which is why it renders full-height on the
    // right instead of wrapping inline like every other bookmark/folder.
    // Moving it into the same flex container, at the end, makes it
    // behave like a normal item - a real DOM move, not just CSS, since
    // CSS alone can't relocate an element to a different parent.
    //
    // The element doesn't exist at all until Firefox's own native code
    // creates it (in response to the browser.toolbars.bookmarks.
    // showOtherBookmarks pref, set via our own menu item elsewhere in
    // this file) - which may happen well after this script has already
    // run, or only after a tab switch. A persistent observer on its
    // real parent (#PlacesToolbar) catches it the moment it's created,
    // whenever that actually happens, rather than a single check here
    // that could easily run too early.
    function relocateOtherBookmarksIfPresent() {
      const el = document.getElementById("OtherBookmarks");
      if (el && el.parentNode !== placesToolbarItems) {
        placesToolbarItems.appendChild(el);
      }
    }
    relocateOtherBookmarksIfPresent();
    const placesToolbar = document.getElementById("PlacesToolbar");
    if (placesToolbar) {
      new MutationObserver(relocateOtherBookmarksIfPresent).observe(placesToolbar, {
        childList: true,
        subtree: true,
      });
    }

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
      // A separator node has no children and no URL - render it as a
      // real native <toolbarseparator> (a thin line), not a button. This
      // must be checked BEFORE the general leaf-bookmark path below,
      // which would otherwise treat it as a broken bookmark with no
      // valid icon or URL (the cause of the globe-icon bug).
      const isSeparator =
        node.type === "text/x-moz-place-separator" ||
        (!node.uri && !node.url && node.children === undefined && !node.title);
      if (isSeparator) {
        const sep = document.createXULElement
          ? document.createXULElement("toolbarseparator")
          : document.createElement("toolbarseparator");
        sep.setAttribute(OWNER_ATTR, ownerGuid);
        sep.setAttribute("data-bmif-guid", node.guid);
        // Same fix as the toolbarbutton path below: Firefox's own native
        // Places view code periodically scans every child of the toolbar
        // and reads its _placesNode.icon regardless of element type -
        // without this stub, it throws an uncaught exception here too,
        // which was silently disrupting unrelated nearby code (this time,
        // the Bookmarks Toolbar visibility menu's own pref-setting).
        sep._placesNode = {
          icon: "",
          type: Ci.nsINavHistoryResultNode.RESULT_TYPE_SEPARATOR,
          uri: "",
          title: "",
          bookmarkGuid: node.guid,
        };
        sep.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          showBookmarkContextMenu(sep, node, "separator", event.screenX, event.screenY);
        });
        return sep;
      }

      const btn = document.createXULElement
        ? document.createXULElement("toolbarbutton")
        : document.createElement("toolbarbutton");

      btn.classList.add("bookmark-item");
      btn.setAttribute("label", node.title || "");
      btn.setAttribute(OWNER_ATTR, ownerGuid);
      btn.setAttribute("data-bmif-guid", node.guid);

      const isFolder = node.type === "text/x-moz-place-container" || node.children !== undefined;

      // Firefox's own native Places view code (browserPlacesViews.js)
      // periodically scans every child of the toolbar and reads its
      // _placesNode.icon, regardless of whether we injected that child
      // ourselves - without this, it throws an uncaught exception on our
      // synthetic elements, which was silently disrupting other native
      // event handling nearby, including middle-click's own auxclick
      // generation. This stub just gives it something valid to read
      // instead of crashing; it does not power any of our own code.
      const nodeUrl = node.uri || node.url || "";
      btn._placesNode = {
        icon: isFolder ? "" : makeFaviconUrl(nodeUrl),
        type: isFolder ? Ci.nsINavHistoryResultNode.RESULT_TYPE_FOLDER : Ci.nsINavHistoryResultNode.RESULT_TYPE_URI,
        uri: nodeUrl,
        title: node.title || "",
        bookmarkGuid: node.guid,
      };

      if (isFolder) {
        btn.setAttribute("type", "menu");
        btn.setAttribute("container", "true");
      } else {
        const url = node.uri || node.url || "";
        btn.setAttribute("data-bmif-url", url);
        btn.setAttribute("image", makeFaviconUrl(url));
        btn.addEventListener("click", (event) => {
          if (event.button !== 0) return; // only handle left-click here - a right-click needs to reach the contextmenu handler below instead, not open the bookmark
          event.preventDefault();
          event.stopPropagation();
          openBookmarkUrl(url, event);
        });
        // Middle-click doesn't reliably fire a plain "click" event for
        // the middle mouse button - "auxclick" is the standard DOM event
        // for non-primary buttons, so it needs its own listener rather
        // than being handled by the click listener above.
        btn.addEventListener("auxclick", (event) => {
          if (event.button !== 1) return; // middle button only
          event.preventDefault();
          event.stopPropagation();
          openBookmarkUrl(url, { ctrlKey: true }); // reuses the "open in new tab" branch in openBookmarkUrl
        });
      }

      // Custom right-click menu (Open/Edit/Delete/etc.) - only for items
      // inside an expanded folder, where our own synthetic elements
      // always carry reliable data we generated ourselves. Regular
      // toolbar bookmarks outside any folder keep using Firefox's own
      // native context menu instead - an earlier attempt to unify both
      // into one custom menu hit a real, unresolved Firefox bug where
      // certain toolbar bookmarks' native _placesNode data becomes
      // unreadable after "Show Other Bookmarks" triggers an overflow
      // recalculation, breaking the menu for exactly those bookmarks.
      btn.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        showBookmarkContextMenu(btn, node, isFolder ? "folder" : "bookmark", event.screenX, event.screenY);
      });

      // Drag-to-reorder within the same expanded folder - see the drag
      // handlers below for the same-parent-only scope of this feature.
      // Folders were never actually draggable in this version to begin
      // with (no explicit blocking code needed for that), and reordering
      // is scoped to bookmarks moving within the same folder they're
      // already in - moving between folders, or between a folder and
      // the main bar, was found to leave Firefox's separate "Bookmarks
      // Toolbar" menu showing a stale, incorrect order with no reliable
      // fix found.
      btn.setAttribute("draggable", "true");
      btn.addEventListener("dragstart", (event) => {
        event.stopPropagation();
        draggedItem = { guid: node.guid, ownerGuid };
        try {
          event.dataTransfer.setData("text/x-bmif-guid", node.guid);
          event.dataTransfer.effectAllowed = "move";
        } catch (ex) {}
      });
      btn.addEventListener("dragend", () => {
        hideNativeDropIndicator();
        draggedItem = null;
      });
      btn.addEventListener("dragover", (event) => {
        // Actively reject (rather than silently ignoring) anything that
        // isn't a same-folder bookmark move - a dragged item we're not
        // tracking (e.g. a native bookmark dragged in from the main bar,
        // which we deliberately don't track at all) would otherwise fall
        // through to Firefox's own native drag-and-drop handling here,
        // which can still complete the move using our synthetic item's
        // _placesNode stub (added elsewhere to prevent a native crash,
        // but which carries a real, working bookmark guid). Explicitly
        // calling preventDefault with dropEffect "none" stops that.
        event.preventDefault();
        if (!draggedItem || draggedItem.ownerGuid !== ownerGuid) {
          try {
            event.dataTransfer.dropEffect = "none";
          } catch (ex) {}
          return;
        }
        event.stopPropagation();
        // Show which side of this item the dragged bookmark will land on,
        // based on which half of the item the cursor is currently over.
        const rect = btn.getBoundingClientRect();
        const before = event.clientX < rect.left + rect.width / 2;
        showNativeDropIndicatorAt(btn, before);
        btn.setAttribute("data-bmif-drop-before", before ? "true" : "false");
      });
      btn.addEventListener("dragleave", () => {
        btn.removeAttribute("data-bmif-drop-before");
      });
      btn.addEventListener("drop", (event) => {
        // Same reasoning as dragover above - actively reject rather than
        // silently ignore, so an untracked drag can't fall through to
        // Firefox's own native handling and complete anyway.
        event.preventDefault();
        if (!draggedItem || draggedItem.ownerGuid !== ownerGuid) return;
        event.stopPropagation();
        const before = btn.getAttribute("data-bmif-drop-before") === "true";
        btn.removeAttribute("data-bmif-drop-before");
        hideNativeDropIndicator();
        reorderWithinFolder(draggedItem.guid, node.guid, ownerGuid, before);
        draggedItem = null;
      });

      return btn;
    }

    // Tracks the item currently being dragged, for the same-parent-only
    // reorder handlers above. Simpler and more reliable than relying
    // solely on dataTransfer, which some drag event phases restrict
    // access to.
    let draggedItem = null;

    // Reuses Firefox's own native drag indicator (the same
    // #PlacesToolbarDropIndicator element already correctly positioned
    // for ordinary, non-folder drags elsewhere in this file) for
    // within-folder reordering too, so the indicator looks identical
    // everywhere rather than us recreating its look from CSS.
    const dropIndicatorEl = document.getElementById("PlacesToolbarDropIndicator");
    const dropIndicatorHolder = document.getElementById("PlacesToolbarDropIndicatorHolder");

    function showNativeDropIndicatorAt(targetEl, before) {
      if (!dropIndicatorEl || !dropIndicatorHolder) return;
      const holderRect = dropIndicatorHolder.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();
      const x = Math.round((before ? targetRect.left : targetRect.right) - holderRect.left);
      const y = Math.round(targetRect.top - holderRect.top);
      dropIndicatorEl.style.setProperty("visibility", "visible", "important");
      dropIndicatorEl.style.setProperty(
        "transform",
        `translate(${x}px, ${y}px)`,
        "important"
      );
      dropIndicatorEl.style.setProperty("margin-inline-start", "-8px", "important");
    }

    function hideNativeDropIndicator() {
      if (!dropIndicatorEl) return;
      dropIndicatorEl.style.removeProperty("visibility");
      dropIndicatorEl.style.removeProperty("transform");
      dropIndicatorEl.style.removeProperty("margin-inline-start");
    }

    // Finds the folder button (native or synthetic) for a given guid,
    // searching every bookmark-item currently in the toolbar/expanded
    // views. Used to re-expand a folder after reordering its children.
    function findFolderButtonByGuid(guid) {
      const candidates = placesToolbarItems.querySelectorAll('.bookmark-item[type="menu"]');
      for (const el of candidates) {
        if (getFolderGuid(el) === guid) return el;
      }
      return null;
    }

    async function reorderWithinFolder(draggedGuid, targetGuid, parentGuid, before) {
      try {
        // Find the target's current position by querying the real,
        // authoritative bookmark order directly from Places rather than
        // the DOM - the DOM only carries OWNER_ATTR for synthetic items
        // inside an expanded folder, so a Places-tree lookup is what lets
        // this same function handle reordering both inside an expanded
        // folder AND directly on the bookmarks bar (or "Other Bookmarks")
        // uniformly.
        const tree = await PlacesUtils.promiseBookmarksTree(parentGuid, {
          includeItemIds: false,
        });
        const children = (tree && tree.children) || [];
        let targetIndex = children.findIndex((c) => c.guid === targetGuid);
        if (targetIndex === -1) return;
        if (!before) targetIndex += 1;

        // Move the dragged item (bookmark or folder) directly to its new
        // index. Folders are allowed to reorder within their current
        // parent the same way bookmarks do - the caller only ever passes
        // a target drawn from the dragged item's own real sibling set, so
        // this can't relocate a folder to a different level of the tree.
        await PlacesUtils.bookmarks.update({ guid: draggedGuid, index: targetIndex });

        // Re-fetch and re-render this folder's contents fresh from Places
        // rather than trying to reorder the existing DOM nodes by hand -
        // guarantees the displayed order always matches the real,
        // authoritative bookmark order. Only applies to synthetic content
        // (inside an expanded folder) - a parentGuid of the toolbar root
        // (or "Other Bookmarks") has no folder button to find here, and
        // needs none: Firefox's own native toolbar view re-renders itself
        // automatically when the underlying bookmark data changes.
        const parentEl = findFolderButtonByGuid(parentGuid);
        if (parentEl) {
          await refreshFolderChildren(parentEl, parentGuid);
        }
      } catch (ex) {
        console.error("[inline-bookmark-folders] Failed to reorder bookmark", ex);
      }
    }

    // Builds and shows a small custom context menu for a bookmark or
    // folder item. This is NOT Firefox's native placesContext menu -
    // hooking a synthetic element into that menu's real target-detection
    // and command system relies on deep, undocumented internals that
    // Mozilla's own bug history shows are fragile even for native nodes.
    // This menu instead implements its own actions directly against the
    // same PlacesUtils.bookmarks API already used elsewhere in this
    // script, trading an exact native look for actions that reliably do
    // what they say.

    function showBookmarkContextMenu(btn, node, itemType, screenX, screenY) {
      const popup = document.createXULElement
        ? document.createXULElement("menupopup")
        : document.createElement("menupopup");

      function addItem(label, onClick, disabled) {
        const item = document.createXULElement
          ? document.createXULElement("menuitem")
          : document.createElement("menuitem");
        item.setAttribute("label", label);
        if (disabled) item.setAttribute("disabled", "true");
        item.addEventListener("command", onClick);
        popup.appendChild(item);
        return item;
      }

      function addSeparator() {
        const sep = document.createXULElement
          ? document.createXULElement("menuseparator")
          : document.createElement("menuseparator");
        popup.appendChild(sep);
      }

      // Refreshes a folder's displayed contents, reflecting whatever
      // changed in Places since it was last rendered. Used after any
      // action that adds, removes, or moves items.
      async function refreshFolder(guid) {
        const el = findFolderButtonByGuid(guid);
        if (!el || el.getAttribute(EXPANDED_ATTR) !== "true") return;
        await refreshFolderChildren(el, guid);
      }

      // Finds this item's current index among its siblings sharing the
      // same parent, for inserting new/pasted items right after it.
      function currentIndexAmongSiblings() {
        const siblings = Array.from(
          placesToolbarItems.querySelectorAll(`[${OWNER_ATTR}="${CSS.escape(ownerGuidOf(btn))}"]`)
        );
        return siblings.findIndex((el) => el === btn);
      }

      function ownerGuidOf(el) {
        return el.getAttribute(OWNER_ATTR);
      }

      if (itemType === "bookmark") {
        const url = btn.getAttribute("data-bmif-url");
        addItem("Open in New Tab", () => openBookmarkUrl(url, { ctrlKey: true }));

        addItem("Open in New Window", () => {
          try {
            window.openTrustedLinkIn(url, "window");
          } catch (ex) {
            console.error("[inline-bookmark-folders] Failed to open in new window", ex);
          }
        });
        addItem("Open in a New Private Window", () => {
          try {
            window.openTrustedLinkIn(url, "window", { private: true });
          } catch (ex) {
            console.error("[inline-bookmark-folders] Failed to open in private window", ex);
          }
        });
        addSeparator();
      }

      if (itemType !== "separator") {
        addItem("Edit Bookmark\u2026", async () => {
          // A simplified version of native's Edit Bookmark panel - title
          // only, not the full title+location+folder editor.
          try {
            const input = { value: node.title || "" };
            const ok = Services.prompt.prompt(
              window,
              "Edit Bookmark",
              "Name:",
              input,
              null,
              { value: false }
            );
            if (ok && input.value !== null) {
              await PlacesUtils.bookmarks.update({ guid: node.guid, title: input.value });
              btn.setAttribute("label", input.value);
              node.title = input.value;
            }
          } catch (ex) {
            console.error("[inline-bookmark-folders] Failed to edit bookmark", ex);
          }
        });
      }

      addItem(itemType === "separator" ? "Delete" : "Delete Bookmark", async () => {
        try {
          const parentGuid = ownerGuidOf(btn);
          if (btn.getAttribute(EXPANDED_ATTR) === "true") {
            collapseFolder(node.guid);
          }
          await PlacesUtils.bookmarks.remove(node.guid);
          btn.remove();
        } catch (ex) {
          console.error("[inline-bookmark-folders] Failed to delete bookmark", ex);
        }
      });

      addSeparator();

      addItem("Add Bookmark\u2026", async () => {
        try {
          const urlInput = { value: "https://" };
          const okUrl = Services.prompt.prompt(window, "Add Bookmark", "URL:", urlInput, null, {
            value: false,
          });
          if (!okUrl) return;
          const titleInput = { value: urlInput.value };
          const okTitle = Services.prompt.prompt(
            window,
            "Add Bookmark",
            "Name:",
            titleInput,
            null,
            { value: false }
          );
          if (!okTitle) return;
          const parentGuid = ownerGuidOf(btn);
          await PlacesUtils.bookmarks.insert({
            parentGuid,
            index: currentIndexAmongSiblings() + 1,
            url: urlInput.value,
            title: titleInput.value,
          });
          await refreshFolder(parentGuid);
        } catch (ex) {
          console.error("[inline-bookmark-folders] Failed to add bookmark", ex);
        }
      });

      addItem("Add Folder\u2026", async () => {
        try {
          const input = { value: "New Folder" };
          const ok = Services.prompt.prompt(window, "Add Folder", "Name:", input, null, {
            value: false,
          });
          if (!ok) return;
          const parentGuid = ownerGuidOf(btn);
          await PlacesUtils.bookmarks.insert({
            parentGuid,
            index: currentIndexAmongSiblings() + 1,
            type: PlacesUtils.bookmarks.TYPE_FOLDER,
            title: input.value,
          });
          await refreshFolder(parentGuid);
        } catch (ex) {
          console.error("[inline-bookmark-folders] Failed to add folder", ex);
        }
      });

      addItem("Add Separator", async () => {
        try {
          const parentGuid = ownerGuidOf(btn);
          await PlacesUtils.bookmarks.insert({
            parentGuid,
            index: currentIndexAmongSiblings() + 1,
            type: PlacesUtils.bookmarks.TYPE_SEPARATOR,
          });
          await refreshFolder(parentGuid);
        } catch (ex) {
          console.error("[inline-bookmark-folders] Failed to add separator", ex);
        }
      });

      addSeparator();

      // "Bookmarks Toolbar" visibility submenu - real, confirmed pref
      // from Firefox's own source (browser-places.js's
      // toggleBookmarksToolbar). Toolbar-wide, not really about this
      // specific bookmark, but included since you asked for full parity.
      const toolbarMenu = document.createXULElement
        ? document.createXULElement("menu")
        : document.createElement("menu");
      toolbarMenu.setAttribute("label", "Bookmarks Toolbar");
      const toolbarPopup = document.createXULElement
        ? document.createXULElement("menupopup")
        : document.createElement("menupopup");
      [
        ["Always Show", "always"],
        ["Never Show", "never"],
        ["Only Show on New Tab", "newtab"],
      ].forEach(([label, value]) => {
        const item = document.createXULElement
          ? document.createXULElement("menuitem")
          : document.createElement("menuitem");
        item.setAttribute("label", label);
        item.addEventListener("command", () => {
          try {
            Services.prefs.setCharPref("browser.toolbars.bookmarks.visibility", value);
            // Firefox's own native code only re-evaluates this pref on a
            // tab switch. Rather than trying to trigger that native
            // mechanism early (an earlier attempt at that broke the
            // pref-setting itself), directly set the same [collapsed]
            // attribute our own existing CSS already reacts to (built
            // earlier in this project for the "Never Show" setting) -
            // this applies immediately, with no dependency on Firefox's
            // own reactive timing at all.
            const personalToolbar = document.getElementById("PersonalToolbar");
            if (personalToolbar) {
              if (value === "always") {
                personalToolbar.removeAttribute("collapsed");
              } else if (value === "never") {
                personalToolbar.setAttribute("collapsed", "true");
              } else if (value === "newtab") {
                const isNewTab =
                  gBrowser &&
                  gBrowser.selectedBrowser &&
                  gBrowser.selectedBrowser.currentURI &&
                  gBrowser.selectedBrowser.currentURI.spec === "about:newtab";
                if (isNewTab) {
                  personalToolbar.removeAttribute("collapsed");
                } else {
                  personalToolbar.setAttribute("collapsed", "true");
                }
              }
            }
          } catch (ex) {
            console.error("[inline-bookmark-folders] Failed to set toolbar visibility", ex);
          }
        });
        toolbarPopup.appendChild(item);
      });
      toolbarMenu.appendChild(toolbarPopup);
      popup.appendChild(toolbarMenu);

      // "Show Other Bookmarks" - no confirmed underlying pref found for
      // "Show Other Bookmarks" uses a real, dedicated native pref
      // (browser.toolbars.bookmarks.showOtherBookmarks, confirmed from
      // Mozilla's own support documentation) - our earlier attempts to
      // find/toggle the toolbar element directly (document.getElementById
      // ("OtherBookmarks")) always came back empty because the element
      // genuinely doesn't exist until Firefox's own native code creates
      // it in response to this specific pref, which we were never
      // actually setting. Like the Bookmarks Toolbar visibility submenu
      // above, this may require a tab switch to visually take effect.
      addItem("Show Other Bookmarks", () => {
        try {
          const PREF = "browser.toolbars.bookmarks.showOtherBookmarks";
          const current = Services.prefs.getBoolPref(PREF, false);
          Services.prefs.setBoolPref(PREF, !current);
        } catch (ex) {
          console.error("[inline-bookmark-folders] Failed to toggle Other Bookmarks", ex);
        }
      });

      addItem("Manage Bookmarks", () => {
        try {
          PlacesCommandHook.showPlacesOrganizer("BookmarksToolbar");
        } catch (ex) {
          console.error("[inline-bookmark-folders] Failed to open Library", ex);
        }
      });

      // Keep the toolbar open for as long as this menu is genuinely
      // shown, using the same [forceopen] mechanism already proven
      // reliable for download-forceopen.uc.js's toolbar reveal - real
      // popupshown/popuphidden events, rather than depending on a CSS
      // :hover selector correctly tracking a freshly-created element
      // (which didn't reliably work for this custom popup).
      if (navigatorToolbox) {
        popup.addEventListener("popupshown", () => {
          navigatorToolbox.setAttribute("forceopen", "true");
        });
        popup.addEventListener(
          "popuphidden",
          () => navigatorToolbox.removeAttribute("forceopen"),
          { once: true }
        );
      }

      popup.addEventListener("popuphidden", () => popup.remove(), { once: true });
      const mainPopupSet = document.getElementById("mainPopupSet") || document.documentElement;
      mainPopupSet.appendChild(popup);
      popup.openPopupAtScreen(screenX, screenY, true);
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
          el.addEventListener("mousedown", preventNativeFolderPopup, true);
          el.addEventListener("click", handleFolderClick, true);
        }
      }
      folderButton.setAttribute(EXPANDED_ATTR, "true");
    }

    // Re-renders an already-expanded folder's contents from Places -
    // used after any action that adds, removes, or reorders items inside
    // it (as opposed to expandFolder, which is only for a folder that was
    // actually closed). Fetches the new children FIRST, while the old
    // ones are still on screen, then swaps old for new in one
    // synchronous pass with no `await` in between and without ever
    // clearing EXPANDED_ATTR - collapsing immediately and fetching
    // afterward (the old approach, still used by callers that go through
    // collapseFolder + expandFolder directly) left a real gap - one or
    // more rendered frames with the folder's contents fully removed -
    // which is what showed up as a flicker.
    async function refreshFolderChildren(folderButton, guid) {
      const children = await fetchChildren(guid);

      collapseFolder(guid);
      let insertAfter = folderButton;
      for (const child of children) {
        const el = buildItemElement(child, guid);
        insertAfter.after(el);
        insertAfter = el;
        if (el.getAttribute("type") === "menu") {
          el.addEventListener("mousedown", preventNativeFolderPopup, true);
          el.addEventListener("click", handleFolderClick, true);
        }
      }
      folderButton.setAttribute(EXPANDED_ATTR, "true");
    }

    // Two confirmed-by-testing facts drive the design below:
    //   1. preventDefault() on mousedown stops the native popup from
    //      opening, but does NOT free the element for an HTML5 drag -
    //      Firefox's type="menu" toolbarbutton binding still captures the
    //      press for its own gesture recognition regardless.
    //   2. Temporarily stripping "type"/"container" during the press
    //      doesn't unlock a drag either - it just breaks the button's
    //      rendering (icon falls back to a globe) for no benefit.
    // So folder reordering doesn't use the browser's native drag-and-drop
    // (dragstart/dragover/drop) at all - it's tracked entirely by hand
    // with plain mousedown/mousemove/mouseup, which sidesteps the
    // type="menu" gesture-capture problem completely since we're not
    // asking the browser to recognize a drag on that element in the
    // first place.
    let manualFolderDrag = null; // { target, guid, parentGuid, siblingGuids, startX, startY, dragging, targetGuid, before }
    const MANUAL_DRAG_THRESHOLD = 6;

    function preventNativeFolderPopup(event) {
      if (event.button !== 0) return;
      const target = event.target.closest
        ? event.target.closest("toolbarbutton")
        : event.target;
      if (!isFolderButton(target)) return;

      // Block the native default (popup opening). Deliberately NOT
      // calling stopPropagation() so this doesn't interfere with
      // anything else listening for this mousedown.
      event.preventDefault();

      const guid = getFolderGuid(target);
      if (!guid) return;

      const startX = event.clientX;
      const startY = event.clientY;

      // Look up the folder's real current parent and sibling list once,
      // up front, rather than per mousemove tick - reorder targets are
      // matched against this fixed snapshot (same approach the drop
      // handler itself uses), so this works identically whether the
      // folder lives directly on the bookmarks bar (or under "Other
      // Bookmarks") or inside an expanded parent folder.
      PlacesUtils.bookmarks
        .fetch(guid)
        .then(async (info) => {
          if (!info || !manualFolderDrag || manualFolderDrag.guid !== guid) return;
          const tree = await PlacesUtils.promiseBookmarksTree(info.parentGuid, {
            includeItemIds: false,
          });
          const children = (tree && tree.children) || [];
          manualFolderDrag.parentGuid = info.parentGuid;
          manualFolderDrag.siblingGuids = new Set(children.map((c) => c.guid));
        })
        .catch((ex) => {
          console.error("[inline-bookmark-folders] Failed to prepare folder drag", ex);
        });

      manualFolderDrag = {
        target,
        guid,
        parentGuid: null, // filled in asynchronously above
        siblingGuids: null,
        startX,
        startY,
        dragging: false,
        targetGuid: null,
        before: null,
      };

      window.addEventListener("mousemove", handleManualFolderDragMove, true);
      window.addEventListener("mouseup", handleManualFolderDragEnd, true);
    }

    // Sets/clears a "cursor mode" attribute on the root element for the
    // duration of a manual folder drag. Applied to <html> rather than the
    // dragged element itself because the mouse spends most of a drag
    // hovering OTHER elements, each of which may carry its own CSS
    // cursor - only a rule targeting every element while this attribute
    // is present (see userChrome.css) can reliably override those.
    function setManualDragCursor(mode) {
      const root = document.documentElement;
      if (mode) {
        root.setAttribute("data-bmif-drag-cursor", mode);
      } else {
        root.removeAttribute("data-bmif-drag-cursor");
      }
    }

    function handleManualFolderDragMove(event) {
      if (!manualFolderDrag) return;
      const dx = event.clientX - manualFolderDrag.startX;
      const dy = event.clientY - manualFolderDrag.startY;

      if (!manualFolderDrag.dragging) {
        if (Math.abs(dx) < MANUAL_DRAG_THRESHOLD && Math.abs(dy) < MANUAL_DRAG_THRESHOLD) return;
        // Not ready yet (parentGuid/siblingGuids still resolving) - just
        // wait for the next tick rather than starting to track a drag we
        // can't validate targets against.
        if (!manualFolderDrag.siblingGuids) return;
        manualFolderDrag.dragging = true;
        manualFolderDrag.target.setAttribute("data-bmif-manual-dragging", "true");
        // The press started on the folder itself, which is always a
        // valid (no-op) position - start out as "allowed" rather than
        // "forbidden" so there isn't a one-frame flash of the wrong
        // cursor before the first real hover check below runs.
        setManualDragCursor("grabbing");
      }

      const el = document.elementFromPoint(event.clientX, event.clientY);
      const hovered = el && el.closest ? el.closest(".bookmark-item") : null;

      // Hovering the dragged folder itself (no net move yet) is allowed
      // but isn't a reorder target - leave any previous target/indicator
      // as-is rather than clearing it on every tiny jitter back onto it.
      if (hovered === manualFolderDrag.target) {
        setManualDragCursor("grabbing");
        return;
      }

      const hoveredGuid = hovered ? getFolderGuid(hovered) : null;
      const isValidTarget =
        hoveredGuid && manualFolderDrag.siblingGuids.has(hoveredGuid);

      if (!isValidTarget) {
        // Either off the toolbar entirely, or over something that isn't
        // a sibling of the dragged folder (a different folder's own
        // expanded contents, another part of the browser, etc.) - not a
        // legal drop position, so show the forbidden cursor and clear
        // any previously-armed target.
        setManualDragCursor("forbidden");
        hideNativeDropIndicator();
        manualFolderDrag.targetGuid = null;
        manualFolderDrag.before = null;
        return;
      }

      setManualDragCursor("grabbing");
      const rect = hovered.getBoundingClientRect();
      const before = event.clientX < rect.left + rect.width / 2;
      showNativeDropIndicatorAt(hovered, before);
      manualFolderDrag.targetGuid = hoveredGuid;
      manualFolderDrag.before = before;
    }

    function handleManualFolderDragEnd() {
      window.removeEventListener("mousemove", handleManualFolderDragMove, true);
      window.removeEventListener("mouseup", handleManualFolderDragEnd, true);
      if (!manualFolderDrag) return;
      const state = manualFolderDrag;
      manualFolderDrag = null;

      if (state.target) state.target.removeAttribute("data-bmif-manual-dragging");
      setManualDragCursor(null);
      hideNativeDropIndicator();

      if (!state.dragging) return; // plain press+release - handleFolderClick handles opening/closing it

      // The browser still fires a "click" on mouseup here (we never used
      // native drag-and-drop, so there's no dragstart to suppress it) -
      // needs to be swallowed so releasing a drag doesn't also toggle
      // something open/closed. That click lands on whatever's under the
      // cursor at drop time, which is usually NOT the dragged folder
      // itself (it's the target you dropped onto - a bookmark, empty
      // space, a different folder) and often isn't a folder at all - so
      // a flag checked only inside handleFolderClick's folder-specific
      // path would frequently miss it entirely (bailing out at the
      // isFolderButton() check before ever seeing the flag) and stay
      // stuck true, silently eating some later, unrelated folder click
      // instead. A one-shot capture-phase listener at the window level
      // swallows exactly the next click regardless of its target, so
      // there's nothing left over to misfire later. The timeout is a
      // safety net in case a click never arrives at all (some browsers
      // skip it after enough pointer movement) - without it, this would
      // otherwise sit armed indefinitely waiting to eat a real click.
      let clickConsumed = false;
      function eatNextClick(event) {
        clickConsumed = true;
        event.preventDefault();
        event.stopPropagation();
      }
      window.addEventListener("click", eatNextClick, { capture: true, once: true });
      setTimeout(() => {
        if (!clickConsumed) window.removeEventListener("click", eatNextClick, true);
      }, 500);

      if (state.targetGuid && state.parentGuid) {
        reorderWithinFolder(state.guid, state.targetGuid, state.parentGuid, state.before);
      }
    }

    function handleFolderClick(event) {
      if (event.button !== 0) return; // only left-click should toggle expand/collapse - a right-click needs to reach the contextmenu handler instead
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

    // Capture-phase listeners on the toolbar container catch presses/clicks
    // on both native folder buttons and any we inject later (event
    // delegation). mousedown still has to run in capture phase and call
    // preventDefault() because Firefox's native type="menu" toolbarbuttons
    // open their popup as part of mousedown's own default action - a
    // click-based listener alone runs too late to block it. The actual
    // toggle is deferred to click (see handleFolderClick above) so a
    // mousedown that turns into a drag never gets treated as a click.
    placesToolbarItems.addEventListener("mousedown", preventNativeFolderPopup, true);
    placesToolbarItems.addEventListener("click", handleFolderClick, true);

    // Safety net: ensures nothing can stay permanently stuck in the
    // drag-hover state (highlighted, type removed) if dragleave doesn't
    // fire reliably for some reason - possibly our own doing, since
    // removing "type" mid-drag may confuse the browser's own drag
    // tracking for that element. dragend always fires when a drag ends,
    // however it ended, making it a reliable cleanup point regardless of
    // the exact cause.
    function restoreFromDragHover(el) {
      el.removeAttribute("data-bmif-drag-hover");
      el.setAttribute("type", "menu");
      // Removing "type" mid-drag apparently interrupts Firefox's own
      // native popup-opening sequence for this button - confirmed via
      // direct inspection that it leaves a real "open" attribute stuck
      // on the element, which Firefox's own native CSS uses to apply a
      // permanent highlighted background. Firefox's own code would
      // normally clear this when the (interrupted) sequence finishes;
      // since we're the ones interrupting it, we clear it ourselves.
      el.removeAttribute("open");
    }
    placesToolbarItems.addEventListener(
      "dragend",
      () => {
        const stuck = placesToolbarItems.querySelectorAll('[data-bmif-drag-hover="true"]');
        stuck.forEach(restoreFromDragHover);
      },
      true
    );

    // Blocks dropping a dragged bookmark directly onto a NATIVE
    // top-level folder's own icon - these have none of our other
    // drag-and-drop handling attached to them at all (they're not
    // created by buildItemElement, so without this, a drop on one falls
    // straight through to Firefox's own native handling, which silently
    // completes the move using its own logic). Deliberately scoped to
    // native folders only (lacking OWNER_ATTR) - a SYNTHETIC folder
    // inside an expanded view is a legitimate sibling to reorder around
    // when moving another bookmark within that same folder, and already
    // has correct handling via the existing ownerGuid check elsewhere.
    // Only the middle portion of a native folder button's own width counts
    // as "hovering its icon" (i.e. "file this bookmark into the folder").
    // Hovering near either edge is left alone so Firefox's native
    // reordering can still position the dragged bookmark right before or
    // after the folder - exactly like it would beside any other bookmark.
    // Without this distinction, the checks below were using the folder's
    // entire bounding box, which also blocked simply dropping next to it.
    const FOLDER_ICON_EDGE_MARGIN = 0.25;

    function isOverFolderIconCenter(target, event) {
      const rect = target.getBoundingClientRect();
      if (!rect.width) return false;
      const relativeX = (event.clientX - rect.left) / rect.width;
      return relativeX > FOLDER_ICON_EDGE_MARGIN && relativeX < 1 - FOLDER_ICON_EDGE_MARGIN;
    }

    placesToolbarItems.addEventListener(
      "dragover",
      (event) => {
        const target = event.target.closest ? event.target.closest(".bookmark-item") : null;
        // Once we've removed "type" below, isFolderButton() alone would
        // stop recognizing this element on every subsequent dragover
        // tick during the same hover (it checks for that exact
        // attribute) - the data-bmif-drag-hover marker keeps it
        // correctly treated as a folder target for the rest of the
        // hover regardless.
        const isTarget =
          target &&
          !target.hasAttribute(OWNER_ATTR) &&
          (isFolderButton(target) || target.hasAttribute("data-bmif-drag-hover"));
        if (!isTarget) return;

        if (!isOverFolderIconCenter(target, event)) {
          // Near the edge, not the icon - let this fall through to
          // Firefox's native handling so it can be positioned beside the
          // folder instead. Still clean up drag-hover state left over
          // from a moment ago when the cursor may have been centered.
          if (target.hasAttribute("data-bmif-drag-hover")) {
            restoreFromDragHover(target);
          }
          return;
        }

        event.preventDefault();
        try {
          event.dataTransfer.dropEffect = "none";
        } catch (ex) {}
        // Blocking the drop itself (above) doesn't stop a separate
        // native behavior: Firefox auto-opens a type="menu" toolbar
        // button's own dropdown while something is dragged over it,
        // regardless of whether the drop would actually be accepted.
        // Experimental, same technique used earlier for a different
        // native-popup issue: temporarily remove the "type" attribute
        // itself (which is what triggers this) for as long as the drag
        // is hovering here, restoring it once it leaves or drops.
        if (target.getAttribute("type") === "menu") {
          target.setAttribute("data-bmif-drag-hover", "true");
          target.removeAttribute("type");
        }
      },
      true
    );
    placesToolbarItems.addEventListener(
      "dragleave",
      (event) => {
        const target = event.target.closest ? event.target.closest(".bookmark-item") : null;
        if (target && target.hasAttribute("data-bmif-drag-hover")) {
          restoreFromDragHover(target);
        }
      },
      true
    );
    placesToolbarItems.addEventListener(
      "drop",
      (event) => {
        const target = event.target.closest ? event.target.closest(".bookmark-item") : null;
        if (target && target.hasAttribute("data-bmif-drag-hover")) {
          restoreFromDragHover(target);
        }
        if (!target || target.hasAttribute(OWNER_ATTR) || !isFolderButton(target)) return;
        if (!isOverFolderIconCenter(target, event)) return; // beside it, not onto it - let native handling place it
        event.preventDefault();
        event.stopPropagation();
      },
      true
    );

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
          // the user. [forceopen] specifically covers our own custom
          // right-click menu, which lives outside navigator-toolbox's own
          // bounding box (it's appended to #mainPopupSet), so moving the
          // mouse onto it genuinely triggers a real mouseleave here even
          // though the toolbar itself correctly stays open.
          if (navigatorToolbox.matches(":hover, :focus-within") || navigatorToolbox.hasAttribute("forceopen")) return;
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

    // --------------------------------------------------------------
    // Multi-row Bookmarks Bar - Drop Indicator Row Fix
    //
    // Firefox's native drag-and-drop indicator for reordering bookmarks
    // (#PlacesToolbarDropIndicator) only ever sets a horizontal (X)
    // offset on itself during a drag - confirmed by directly observing
    // its style attribute mid-drag, which only ever contains
    // `transform: translate(XXXpx);` with no vertical component at all.
    // That's fine on a normal single-row bookmarks bar, but with a
    // multi-row bar (see multi-row_bookmarks.css in userChrome.css) it
    // means the indicator always renders at row 1's vertical position,
    // regardless of which row is actually being dragged over.
    //
    // Fix: track the real cursor position ourselves during a drag via a
    // dragover listener, work out which row that corresponds to, and
    // whenever Firefox updates the indicator's own style, immediately
    // patch in the correct vertical offset alongside Firefox's own
    // (already correct) horizontal one.
    // --------------------------------------------------------------
    if (dropIndicatorEl) {
      let currentRowOffsetY = 0;

      function updateRowOffsetFromEvent(event) {
        const items = Array.from(placesToolbarItems.children).filter(
          (el) => el.getBoundingClientRect().height > 0
        );
        if (items.length === 0) return;

        const containerRect = placesToolbarItems.getBoundingClientRect();
        let bestTop = items[0].getBoundingClientRect().top;

        for (const item of items) {
          const rect = item.getBoundingClientRect();
          if (event.clientY >= rect.top && event.clientY <= rect.bottom) {
            bestTop = rect.top;
            break;
          }
          if (rect.top <= event.clientY) {
            bestTop = rect.top;
          }
        }

        currentRowOffsetY = Math.round(bestTop - containerRect.top);
      }

      // Capturing phase so this fires even for Firefox's own native
      // drag, not just drags our other code here initiates.
      placesToolbarItems.addEventListener("dragover", updateRowOffsetFromEvent, true);

      // Rejects dropping a dragged bookmark onto genuinely empty
      // background space on the toolbar (as opposed to a specific
      // bookmark or folder, which already have their own handling and
      // call stopPropagation when accepting a valid drop, so this never
      // runs for those). Without this, such a drop falls straight
      // through to Firefox's own native handling, which was silently
      // appending it to the toolbar's start regardless of where in the
      // empty space it was actually dropped.
      placesToolbarItems.addEventListener(
        "dragover",
        (event) => {
          const onItem = event.target.closest ? event.target.closest(".bookmark-item") : null;
          if (onItem) {
            // Moving back onto a valid target - clear any forced-hidden
            // override from a moment ago so the indicator can show again
            // normally, whether that's handled by our own code (for a
            // synthetic item) or Firefox's own native positioning (for a
            // native one).
            try {
              dropIndicatorEl.style.removeProperty("visibility");
            } catch (ex) {}
            return;
          }
          event.preventDefault();
          try {
            event.dataTransfer.dropEffect = "none";
          } catch (ex) {}
          // Also force-hide the native line-and-circle drop indicator
          // while hovering here. hideNativeDropIndicator() only removes
          // OUR OWN prior overrides - it doesn't help here, since this is
          // a genuine native drag and Firefox's own code is the one
          // actively showing the indicator, independent of our
          // dropEffect rejection. Forcing visibility: hidden directly
          // overrides that regardless.
          try {
            dropIndicatorEl.style.setProperty("visibility", "hidden", "important");
          } catch (ex) {}
        },
        true
      );
      placesToolbarItems.addEventListener(
        "drop",
        (event) => {
          const onItem = event.target.closest ? event.target.closest(".bookmark-item") : null;
          if (onItem) return;
          event.preventDefault();
          event.stopPropagation();
        },
        true
      );

      const dropIndicatorObserver = new MutationObserver(() => {
        const style = dropIndicatorEl.getAttribute("style") || "";
        const match = style.match(/translate\(([-\d.]+)px\)/);
        if (!match) return; // not the single-axis form we know how to patch

        const x = match[1];
        // Avoid triggering ourselves in an infinite loop: if our own
        // correction is already present, do nothing.
        if (style.includes(`translate(${x}px, ${currentRowOffsetY}px)`)) return;

        const newStyle = style.replace(
          /translate\([-\d.]+px\)/,
          `translate(${x}px, ${currentRowOffsetY}px)`
        );
        dropIndicatorEl.setAttribute("style", newStyle);
      });

      dropIndicatorObserver.observe(dropIndicatorEl, {
        attributes: true,
        attributeFilter: ["style"],
      });
    }

    // NOTE: Firefox's native #placesContext menu turned out to already
    // have its own "Show Other Bookmarks" item - an earlier version of
    // this script added a second, duplicate one here, which has been
    // removed. Our persistent relocation observer (built earlier in this
    // file) still correctly moves the "Other Bookmarks" element into the
    // right place whenever it appears, regardless of which toggle
    // (native or ours, inside a folder) actually changed the
    // underlying pref.

    // Keeps the toolbar (tabs/nav-bar/bookmarks bar) visible for as long
    // as any of Firefox's own separate Bookmarks-button menus are open -
    // including while dragging to reorder something inside one. These
    // are real popups living outside #navigator-toolbox's own bounding
    // box, so the mouse being over one still genuinely triggers
    // navigator-toolbox's own mouseleave, which our auto-hide logic
    // would otherwise treat as "the user moved away." Same [forceopen]
    // mechanism already used for our own custom context menu elsewhere
    // in this file. Covers the main Bookmarks menu itself plus its
    // Bookmarks Toolbar, Other Bookmarks, and Mobile Bookmarks
    // submenus - the specific ids Firefox's own source code uses for
    // these (confirmed via direct source lookup).
    const bmbPopupIds = [
      "BMB_bookmarksPopup",
      "BMB_bookmarksToolbarPopup",
      "BMB_unsortedBookmarksPopup",
      "BMB_mobileBookmarksPopup",
    ];
    if (navigatorToolbox) {
      // Moving a bookmark between two different groups (e.g. from
      // Bookmarks Toolbar into Other Bookmarks) closes the first
      // submenu and opens the second as part of that same navigation -
      // there's a brief real gap between the old one's popuphidden and
      // the new one's popupshown where neither has forceopen set, and if
      // the toolbar's own hide-timer happens to land in that gap, it
      // hides. Delaying the removal (rather than clearing it
      // immediately) gives the next submenu a chance to re-claim
      // forceopen before the removal ever takes effect. Shared across
      // all these popups so any one of them opening cancels a pending
      // removal from a different one closing.
      let bmbForceOpenTimer = null;
      bmbPopupIds.forEach((id) => {
        const popup = document.getElementById(id);
        if (!popup) return;
        popup.addEventListener("popupshown", () => {
          if (bmbForceOpenTimer) {
            clearTimeout(bmbForceOpenTimer);
            bmbForceOpenTimer = null;
          }
          navigatorToolbox.setAttribute("forceopen", "true");
        });
        popup.addEventListener("popuphidden", () => {
          if (bmbForceOpenTimer) clearTimeout(bmbForceOpenTimer);
          bmbForceOpenTimer = setTimeout(() => {
            navigatorToolbox.removeAttribute("forceopen");
            bmbForceOpenTimer = null;
          }, 400);
        });
        // Directly tracks whether a bookmark drag is actively happening,
        // independent of which specific popup is open or closing at any
        // given moment - sidesteps the whole race-condition problem the
        // popupshown/popuphidden timing above was trying to paper over.
        // Keeps the toolbar forced open for the entire duration of any
        // drag that starts inside one of these menus, cancelling any
        // pending removal immediately and only allowing it again once
        // the drag genuinely ends.
        popup.addEventListener("dragstart", () => {
          if (bmbForceOpenTimer) {
            clearTimeout(bmbForceOpenTimer);
            bmbForceOpenTimer = null;
          }
          navigatorToolbox.setAttribute("forceopen", "true");
        });
        // dragover fires continuously while actively hovering during a
        // drag, unlike popupshown (which only fires once, when something
        // NEWLY opens). This is what's actually needed for dragging back
        // into the main bookmarks list specifically - that popup was
        // already open the whole time, so it never fires a fresh
        // popupshown to cancel the removal timer a submenu's popuphidden
        // just scheduled when you left it. Continuously cancelling here
        // keeps forceopen alive for as long as the drag is genuinely
        // still hovering anywhere in these menus, regardless of whether
        // anything new opened.
        popup.addEventListener("dragover", () => {
          if (bmbForceOpenTimer) {
            clearTimeout(bmbForceOpenTimer);
            bmbForceOpenTimer = null;
          }
          navigatorToolbox.setAttribute("forceopen", "true");
        });
        popup.addEventListener("dragend", () => {
          if (bmbForceOpenTimer) clearTimeout(bmbForceOpenTimer);
          bmbForceOpenTimer = setTimeout(() => {
            navigatorToolbox.removeAttribute("forceopen");
            bmbForceOpenTimer = null;
          }, 400);
        });
      });
    }

    // Fixes a leading, orphaned separator in Firefox's own NATIVE
    // placesContext menu - only relevant to native top-level bookmarks-
    // bar separators, since our own custom menu (synthetic items inside
    // an expanded folder) is fixed directly in showBookmarkContextMenu
    // instead. Confirmed from Firefox's actual source
    // (placesContextMenu.inc.xhtml): placesContext_openSeparator divides
    // the "Open"/"Open in Tab"/etc. group from what follows, but unlike
    // every item in that group, it has no node-type restriction of its
    // own - so for a separator selection (where every item in that group
    // is hidden, since none of them apply to node-type="separator") it's
    // left stranded alone at the top of the menu with nothing above it.
    // Firefox's own menu-building code (which reactively hides/shows
    // every other item here on each "popupshowing") never touches this
    // one, so it has to be handled by hand. Runs on the same event
    // Firefox's own code uses, registered well after browser startup, so
    // by the time this fires the native hide/show pass has already
    // completed for this popup.
    function isReallyHidden(el) {
      // Covers every way Firefox's own code might have marked this
      // sibling as not-shown, rather than assuming it's always the plain
      // "hidden" IDL property.
      return (
        el.hidden ||
        el.getAttribute("hidden") === "true" ||
        el.collapsed ||
        getComputedStyle(el).display === "none"
      );
    }

    const placesContextPopup = document.getElementById("placesContext");
    if (placesContextPopup) {
      placesContextPopup.addEventListener("popupshowing", () => {
        // Deferred with queueMicrotask rather than run inline: Firefox's
        // own hide/show pass for this popup (PlacesUIUtils.
        // placesContextShowing -> ... -> controller.buildContextMenu)
        // runs from its OWN "popupshowing" listener, registered when its
        // static <script> tag first parses during browser startup - long
        // before this script attaches its own listener, so in practice
        // that pass should already be done by the time this one runs.
        // Deferring to a microtask removes any dependency on that
        // ordering being correct at all: every synchronous listener for
        // this same event (native or otherwise) is guaranteed to finish
        // before any queued microtask runs, and a microtask still
        // resolves before the browser paints, so there's no risk of a
        // visible one-frame flash of the separator either way.
        queueMicrotask(() => {
          const openSep = document.getElementById("placesContext_openSeparator");
          if (!openSep) return;
          let anyVisibleBefore = false;
          let sib = openSep.previousElementSibling;
          while (sib) {
            if (!isReallyHidden(sib)) {
              anyVisibleBefore = true;
              break;
            }
            sib = sib.previousElementSibling;
          }
          // Only ever overrides this one separator's own hidden state -
          // bookmarks/folders (which DO have visible items above it) are
          // left exactly as Firefox's own code already set them.
          openSep.hidden = !anyVisibleBefore;
        });
      });
    }
  }

  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init, { once: true });
  }
})();