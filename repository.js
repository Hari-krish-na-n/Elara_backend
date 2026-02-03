const Repo = (() => {
  const DB_NAME = 'elara-db';
  const DB_VERSION = 1;
  let dbPromise;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('tracks')) {
          db.createObjectStore('tracks', { keyPath: '_id' });
        }
        if (!db.objectStoreNames.contains('playlists')) {
          db.createObjectStore('playlists', { keyPath: '_id' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function putAll(storeName, items) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      items.forEach((item) => store.put(item));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getAll(storeName) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function get(storeName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function put(storeName, item) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(item);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async function del(storeName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async function syncFromServer(apiBase) {
    const songsResp = await fetch(`${apiBase}/songs`);
    const songsData = await songsResp.json();
    const playlistsResp = await fetch(`${apiBase}/playlists`);
    const playlistsData = await playlistsResp.json();
    const tracks = songsData.success ? songsData.songs : [];
    const playlists = playlistsData.success ? playlistsData.playlists : [];
    await putAll('tracks', tracks);
    await putAll('playlists', playlists);
    return { tracks, playlists };
  }

  async function loadFromCache() {
    const tracks = await getAll('tracks');
    const playlists = await getAll('playlists');
    return { tracks, playlists };
  }

  async function savePlaylist(apiBase, playlist) {
    if (navigator.onLine) {
      const resp = await fetch(`${apiBase}/playlists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(playlist),
      });
      const data = await resp.json();
      if (data.success) {
        await put('playlists', data.playlist);
        return data.playlist;
      }
    }
    const local = {
      ...playlist,
      _id: playlist._id || `local-${Date.now()}`,
      songs: playlist.songs || [],
      createdDate: playlist.createdDate || new Date().toISOString(),
    };
    await put('playlists', local);
    return local;
  }

  async function toggleLike(apiBase, trackId) {
    let updated = null;
    const track = await get('tracks', trackId);
    if (navigator.onLine) {
      try {
        const resp = await fetch(`${apiBase}/songs/${trackId}/favorite`, { method: 'POST' });
        const data = await resp.json();
        if (data.success) {
          updated = data.song || { ...track, isFavorite: !(track && track.isFavorite) };
        }
      } catch {
        updated = { ...track, isFavorite: !(track && track.isFavorite) };
      }
    } else {
      updated = { ...track, isFavorite: !(track && track.isFavorite) };
    }
    if (updated) await put('tracks', updated);
    return updated;
  }

  async function incrementPlayCount(apiBase, trackId) {
    let updated = await get('tracks', trackId);
    if (navigator.onLine) {
      try {
        await fetch(`${apiBase}/songs/${trackId}/play`, { method: 'POST' });
      } catch {}
    }
    if (updated) {
      updated.playCount = (updated.playCount || 0) + 1;
      updated.lastPlayed = new Date().toISOString();
      await put('tracks', updated);
    }
    return updated;
  }

  async function removeTrack(apiBase, trackId) {
    if (navigator.onLine) {
      try {
        await fetch(`${apiBase}/songs/${trackId}`, { method: 'DELETE' });
      } catch {}
    }
    await del('tracks', trackId);
    const pls = await getAll('playlists');
    for (const p of pls) {
      p.songs = (p.songs || []).filter((id) => id !== trackId);
      await put('playlists', p);
    }
    return true;
  }

  async function updatePlaylistMembership(apiBase, playlistId, songId, add = true) {
    if (navigator.onLine) {
      const method = add ? 'POST' : 'DELETE';
      await fetch(`${apiBase}/playlists/${playlistId}/songs/${songId}`, { method });
    }
    const playlist = await get('playlists', playlistId);
    if (!playlist) return null;
    const set = new Set(playlist.songs || []);
    if (add) set.add(songId);
    else set.delete(songId);
    playlist.songs = Array.from(set);
    await put('playlists', playlist);
    return playlist;
  }

  return {
    syncFromServer,
    loadFromCache,
    setTracks: (tracks) => putAll('tracks', tracks),
    setPlaylists: (playlists) => putAll('playlists', playlists),
    getAllTracks: () => getAll('tracks'),
    getAllPlaylists: () => getAll('playlists'),
    savePlaylist,
    toggleLike,
    incrementPlayCount,
    removeTrack,
    updatePlaylistMembership,
  };
})();
