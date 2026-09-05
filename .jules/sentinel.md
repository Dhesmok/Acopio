## 2026-08-21 - Unprotected Local Storage Data Wipe on Session Sign-Out
**Vulnerability:** Direct invocation of `Store.salir()` un-authenticates the user and clears all local IndexedDB stores unconditionally, discarding unsynced offline operations and failed queue items.
**Learning:** In offline-first PWA architectures, sign-out actions must guard against wiping client-side state when local modifications (`cola` or `fallidos`) remain un-synchronized to the backend server.
**Prevention:** Always check pending local queue size prior to executing `signOut` and store cleanup, requiring explicit force parameters or pre-sync steps before clearing local databases.
