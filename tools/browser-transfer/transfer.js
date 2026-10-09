/** Local-only hostname transfer. Evaluate in the user's browser; never send the returned backup to a server. */
globalThis.trailMapperTransfer = (() => {
  const oldOrigin = "https://trail-mapper-private.hooware.chatgpt.site";
  const newOrigin = "https://constitution-trail-mapper.hooware.chatgpt.site";
  const prefix = /^trail-mapper\.(county|fixture):/;
  const allowed = /^trail-mapper\.(county|fixture):trail-mapper\.web\.(library(?:\.quarantine)?|session|completed-sessions|active-ride|carried-ride)\.v1$/;
  const recovery = /(?:active-ride|carried-ride)\.v1$/;
  const origin = () => globalThis.location.origin;
  function capture() {
    if (origin() !== oldOrigin) throw new Error("Open the existing private site before exporting.");
    // Planner preferences live in session.v1. This source has no separate settings/IndexedDB/sessionStorage store.
    // Unknown keys anywhere on this dedicated origin need local investigation, never silent omission.
    const entries = Object.keys(localStorage).sort().map((key) => ({ key, value: localStorage.getItem(key) }));
    if (entries.some(({ key }) => !allowed.test(key))) throw new Error("Unknown app storage key: review locally before migration.");
    if (entries.some(({ key }) => /active-ride\.v1$/.test(key))) throw new Error("Stop the ride in the app before exporting, then close other app tabs.");
    return { schema: "trail-mapper.browser-transfer/1", sourceOrigin: oldOrigin, createdAt: new Date().toISOString(), entries };
  }
  function restore(backup) {
    if (origin() !== newOrigin) throw new Error("Open the new site before importing.");
    if (location.pathname !== "/browser-transfer.html" || document.querySelector('meta[name="trail-mapper-transfer"]')?.content !== "1") throw new Error("Import on the dedicated browser-transfer.html page, where the app is not running.");
    if (!backup || backup.schema !== "trail-mapper.browser-transfer/1" || backup.sourceOrigin !== oldOrigin || !Array.isArray(backup.entries) || backup.entries.length > 14) throw new Error("Not a supported browser-library backup.");
    const seen = new Set();
    let bytes = 0;
    for (const entry of backup.entries) {
      if (!entry || typeof entry.key !== "string" || !allowed.test(entry.key) || seen.has(entry.key) || typeof entry.value !== "string") throw new Error("Invalid or duplicate backup entry; nothing imported.");
      seen.add(entry.key);
      bytes += entry.key.length + entry.value.length;
      if (bytes > 10 * 1024 * 1024) throw new Error("Backup exceeds the supported local transfer size.");
    }
    // Keep recovery/history bytes in the backup, but never transplant an in-progress ride to another origin.
    const entries = backup.entries.filter(({ key }) => !recovery.test(key));
    if (Object.keys(localStorage).some((key) => prefix.test(key) && recovery.test(key))) throw new Error("Stop or clear the new site's ride recovery before importing.");
    for (const { key, value } of entries) {
      const current = localStorage.getItem(key);
      if (current !== null && current !== value) throw new Error("The new site already has different app data. Keep both backups and reconcile locally; nothing imported.");
    }
    const written = [];
    try {
      for (const { key, value } of entries) {
        if (localStorage.getItem(key) === null) {
          localStorage.setItem(key, value);
          written.push(key);
        }
        if (localStorage.getItem(key) !== value) throw new Error("Browser storage verification failed.");
      }
    } catch (error) {
      for (const key of written.reverse()) localStorage.removeItem(key);
      throw error;
    }
    return { importedKeys: entries.map(({ key }) => key), recoveryKeysKeptOnlyInBackup: backup.entries.filter(({ key }) => recovery.test(key)).map(({ key }) => key) };
  }
  return Object.freeze({ capture, restore });
})();
