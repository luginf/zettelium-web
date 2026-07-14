'use strict';
// IndexedDB wrapper — promise-based, adapted from writhdeck-web/src/db.js.
//
// Unlike writhdeck-web's flat `documents` store, zettelium-web has no
// document store of its own: notes live exclusively in the user's file
// system, reached through the repositories below (see PLAN.md section 2).
// This module only persists the *registry* of repositories (each holding a
// FileSystemDirectoryHandle — structured-cloneable, so it survives a
// IndexedDB round-trip) and global app settings/meta.
const Storage = (() => {
  const DB_NAME = 'zettelium';
  const DB_VER  = 2;
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('repositories')) {
          db.createObjectStore('repositories', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        // Curseur par note (offset de caractère), clé = `${repositoryId}::${path}`
        // — équivalent de NoteCursorStore.kt (Android round 11 : offset de
        // caractère, pas ligne/colonne, la contrainte ligne/colonne d'un
        // moteur Tcl ne s'applique pas ici non plus qu'à zettelium-android).
        if (!db.objectStoreNames.contains('cursors')) {
          db.createObjectStore('cursors', { keyPath: 'key' });
        }
      };
      req.onsuccess = e => { _db = e.target.result; resolve(_db); };
      req.onerror   = e => reject(e.target.error);
    });
  }

  function tx(store, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const req = fn(s);
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror    = e => reject(e.target.error);
    }));
  }

  function getAllRepositories() {
    return tx('repositories', 'readonly', s => s.getAll());
  }
  function putRepository(repo) {
    return tx('repositories', 'readwrite', s => s.put(repo));
  }
  function deleteRepository(id) {
    return tx('repositories', 'readwrite', s => s.delete(id));
  }

  function getMeta(key) {
    return tx('meta', 'readonly', s => s.get(key)).then(r => r ? r.value : undefined);
  }
  function setMeta(key, value) {
    return tx('meta', 'readwrite', s => s.put({ key, value }));
  }

  function getCursor(key) {
    return tx('cursors', 'readonly', s => s.get(key)).then(r => r ? r.offset : undefined);
  }
  function setCursor(key, offset) {
    return tx('cursors', 'readwrite', s => s.put({ key, offset }));
  }

  return { getAllRepositories, putRepository, deleteRepository, getMeta, setMeta, getCursor, setCursor };
})();
