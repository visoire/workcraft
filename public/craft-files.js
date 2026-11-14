/*
 * WorkCraft: playgroundFiles for an engine page inside a workspace panel. Runs before the WebAssembly module.
 *
 * Builds of the Craft apps made for independent app collections (see SOURCES.md) open, save and
 * autosave through `globalThis.playgroundFiles`. In a WorkCraft panel the files are the project files, so this
 * page asks the workspace (same origin, window.parent.__workcraftFiles, src/workspace/panels/craftapp.ts) to do the
 * work, using the contract in src/storage/app-files-bridge.ts: open, saveAs, write, read, files, remove,
 * download, setUnsaved, onOpen. Paths are "browser:/folder/name.ext" for /folder/name.ext of the project.
 *
 * It only exists inside a workspace. An engine page opened on its own gets nothing from here, so an engine
 * keeps its own fallback (download and file picker). A build that never looks for playgroundFiles is not
 * affected: the object just sits there.
 */
(function () {
  'use strict';
  var w = window;
  if (w.playgroundFiles || w.parent === w) return;

  function host() {
    try {
      var reg = w.parent.__workcraftFiles;
      return reg && reg.forWindow ? reg.forWindow(w) : null;
    } catch (e) {
      return null; // another origin: no workspace to ask
    }
  }
  function call(name, args) {
    var h = host();
    if (!h) return Promise.reject(new Error('playgroundFiles: the workspace is not ready'));
    return h[name].apply(h, args);
  }

  w.playgroundFiles = {
    open: function () { return call('open', arguments); },
    saveAs: function () { return call('saveAs', arguments); },
    write: function () { return call('write', arguments); },
    read: function () { return call('read', arguments); },
    files: function () { return call('files', arguments); },
    remove: function () { return call('remove', arguments); },
    download: function (name, bytes) {
      var h = host();
      if (h) return h.download(name, bytes);
    },
    setUnsaved: function (flag) {
      var h = host();
      if (h) h.setUnsaved(flag);
    },
    // The workspace may not have registered this window yet: keep the callback where it can find it
    onOpen: function (cb) {
      w.__pgOnOpen = cb;
      var h = host();
      if (h) h.onOpen(cb);
    },
  };
})();
