// Tiny deterministic 32-bit hash (FNV-1a). Used for A/B bucket assignment.
// We do NOT use crypto.subtle because it's async and we want sync variant
// resolution before page paint (no FOUC of the wrong CTA text).
function _hash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function _uuidv4() {
  // Native if available, else RFC4122 v4 fallback
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Fallback for very old browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function getOrCreateVisitorId() {
  let id = localStorage.getItem('jac_vid');
  if (!id) {
    id = _uuidv4();
    localStorage.setItem('jac_vid', id);
  }
  return id;
}

function getOrCreateSessionId() {
  let id = sessionStorage.getItem('jac_sid');
  if (!id) {
    id = _uuidv4();
    sessionStorage.setItem('jac_sid', id);
  }
  return id;
}

function getVariant(variantIds) {
  const sticky = localStorage.getItem('jac_ab');
  if (sticky && variantIds.includes(sticky)) return sticky;
  const vid = getOrCreateVisitorId();
  const chosen = variantIds[_hash(vid) % variantIds.length];
  localStorage.setItem('jac_ab', chosen);
  return chosen;
}

// CommonJS export for jest; browser uses global window.JacIdentity (set in analytics.js)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getOrCreateVisitorId, getOrCreateSessionId, getVariant, _hash };
}
