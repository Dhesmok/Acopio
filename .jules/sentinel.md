# Sentinel Security Journal

## 2026-03-29 - Use `crypto.getRandomValues()` for Cryptographically Secure UUID Fallback
**Vulnerability:** Weak pseudo-random number generation (`Math.random()`) in fallback UUID generation.
**Learning:** In non-secure contexts (e.g., HTTP local/testing or older embedded browser webviews), `crypto.randomUUID` may be undefined, falling back to `Math.random()` which is predictable and insecure for generating unique identifiers/UUID v4s.
**Prevention:** Always use `crypto.getRandomValues()` for random byte generation in browser environments when `crypto.randomUUID` is unavailable before resorting to any fallback.
