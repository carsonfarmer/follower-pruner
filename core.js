(() => {
  const defaults = Object.freeze({
    scrollDelay: 250,
    actionDelay: 2000,
    hoverDelay: 350,
    profileLoadDelay: 1000,
    maxFollowerAttempts: 3,
    maxHoverAttempts: 5,
    maxScrollAttempts: 5,
  });
  const keywords = Object.freeze([
    'crypto', 'web3', 'meme', 'degen', 'defi', 'fuck', 'shit', 'dao',
    'dex', '$', 'onlyfans', 'bitcoin', 'solana', 'ethereum', 'nft',
  ]);
  const bioKeywords = Object.freeze([
    'sahara', 'follow', 'spaace_ai', 'btc', 'gnoma', 'airdrop', 'cnpynetwork',
  ]);

  function reasons({ name, handle, bio, followers }) {
    const matches = [];
    if (name?.includes('♦')) matches.push('♦️ in display name');
    for (const [field, text] of Object.entries({ name, handle, bio })) {
      if (typeof text !== 'string') continue;
      const words = field === 'bio' ? [...keywords, ...bioKeywords] : keywords;
      words.forEach(word => {
        if (text.toLowerCase().includes(word)) matches.push(`${field} contains ${word}`);
      });
    }
    if (typeof bio === 'string' && !bio.trim()) matches.push('no bio');
    if (Number.isFinite(followers) && followers >= 0 && followers < 20) {
      matches.push(`${followers} followers (<20)`);
    }
    return matches;
  }

  function parseCount(text) {
    const match = String(text).trim().match(/^(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*([KMB])?(?:\s*Followers?)?$/i);
    if (!match || (match[2] && !match[3])) return null;
    const value = Number(match[1].replaceAll(',', '') + (match[2] || ''));
    const count = value * ({ K: 1e3, M: 1e6, B: 1e9 }[match[3]?.toUpperCase()] || 1);
    return Number.isSafeInteger(Math.round(count)) ? Math.round(count) : null;
  }

  // X often renders emoji as <img alt="…">, which textContent omits.
  function readText(node) {
    if (!node) return '';
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeName === 'IMG') return node.getAttribute('alt') || '';
    if (node.nodeName === 'BR') return '\n';
    return Array.from(node.childNodes || [], readText).join('');
  }

  function settings(input = {}) {
    const result = {};
    for (const [key, fallback] of Object.entries(defaults)) {
      const value = input[key] === undefined ? fallback : Number(input[key]);
      const minimum = key.startsWith('max') ? 1 : 0;
      if (!Number.isSafeInteger(value) || value < minimum || value > 60000) {
        throw new Error(`Invalid setting: ${key}`);
      }
      result[key] = value;
    }
    return result;
  }

  globalThis.FollowerPrunerCore = Object.freeze({ defaults, keywords, bioKeywords, reasons, parseCount, readText, settings });
})();
