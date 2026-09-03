# Sentinel Security Journal

## 2026-03-31 - URL Protocol Sanitization in SVG / HTML Image Rendering
**Vulnerability:** Rendering unsanitized image URLs (`imagen_url`) in SVG `<image href="...">` or HTML `<img src="...">` could allow Cross-Site Scripting (XSS) if malicious URL schemes like `javascript:` are supplied.
**Learning:** `esc()` escapes HTML characters like `<` or `"`, but does not sanitize the URL scheme protocol.
**Prevention:** Always validate URL schemes with `esUrlSegura()` before rendering URLs in `href` or `src` attributes.
