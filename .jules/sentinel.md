## 2.2026-03-31 - Sanitize image URLs for SVG and HTML rendering
**Vulnerability:** XSS and script execution risk via malicious URI schemes (e.g. `javascript:`, `vbscript:`, unsafe `data:` URLs) in `imagen_url` rendered directly into SVG `<image href="...">` or HTML `<img src="...">`.
**Learning:** `esc()` escapes HTML entities (`&`, `<`, `>`, `"`, `'`) but does not filter protocol schemes. When embedding dynamic URLs into attributes like `href` or `src`, URI scheme validation (`escUrl`) is necessary.
**Prevention:** Always validate URI schemes against safe protocols (`http:`, `https:`, `data:image/...`) using `escUrl` before rendering user/admin-supplied URLs into `href` or `src` attributes.
