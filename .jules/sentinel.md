## 2026-07-01 - Public Storage Extension Validation
**Vulnerability:** Public file upload functions (`subirImagenProducto`, `subirImagenFondo`) lacked client-side extension validation, which could allow arbitrary non-image file uploads (e.g., HTML/SVG) to public storage buckets.
**Learning:** Public storage buckets serving static files require explicit file extension whitelisting on upload helpers to prevent stored XSS or content-spoofing vectors.
**Prevention:** Validate file extension against `Set(['jpg', 'jpeg', 'png', 'webp', 'gif'])` before performing `storage.from('mapa').upload()`.
