## 2026-09-12 - Safe Offline Session Termination
**Vulnerability:** Calling `salir()` directly without checking pending offline mutations cleared IndexedDB, causing silent and irreversible loss of local offline data.
**Learning:** In offline-first PWA architectures, session destruction methods must check queue state to prevent data loss unless explicitly forced.
**Prevention:** Enforce checking `pendientes()` before clearing local stores in session termination methods, providing a `forzar` parameter for user-confirmed logouts.
