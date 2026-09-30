'use strict';
function searchURL(query, engine = 'duckduckgo', category = 'web') {
  const q = String(query).trim().slice(0, 2048);
  const google = engine === 'google';
  const url = new URL(google ? 'https://www.google.com/search' : 'https://duckduckgo.com/');
  url.searchParams.set('q', q);
  if (google) {
    const modes = { images: 'isch', videos: 'vid', news: 'nws' };
    if (category === 'maps') return 'https://www.google.com/maps/search/' + encodeURIComponent(q);
    if (modes[category]) url.searchParams.set('tbm', modes[category]);
  } else {
    url.searchParams.set('kl', 'br-pt');
    if (category !== 'web') {
      url.searchParams.set('ia', category);
      if (category !== 'maps') url.searchParams.set('iax', category);
    }
  }
  return url.href;
}
function safeURL(value) {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol); }
  catch { return false; }
}
function destination(input, engine = 'duckduckgo', category = 'web') {
  const value = String(input).trim().slice(0, 4096);
  if (!value) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[\w.-]+:\d+(\/|$)/.test(value)) {
    if (!safeURL(value)) throw new Error('Este tipo de endereço não é permitido. Use HTTP ou HTTPS.');
    return new URL(value).href;
  }
  if (!/\s/.test(value) && /^(localhost|(?:[a-z0-9-]+\.)+[a-z0-9-]+)(:\d+)?(\/.*)?$/i.test(value)) {
    return new URL('https://' + value).href;
  }
  return searchURL(value, engine, category);
}
function isTracker(host, domains) {
  const normalized = String(host).toLowerCase().replace(/\.$/, '');
  return domains.some(domain => normalized === domain || normalized.endsWith('.' + domain));
}
module.exports = { searchURL, destination, safeURL, isTracker };
