'use strict';

const COUNTRY_TRACE = 'https://www.cloudflare.com/cdn-cgi/trace';

async function regionalShortcutURL(entry, session, signal) {
  try {
    const response = await session.fetch(COUNTRY_TRACE, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(4500)]),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error'
    });
    if (response.ok) {
      const country = /^loc=([A-Z]{2})\r?$/m.exec(await response.text())?.[1];
      return entry.regionalUrls[country] ?? entry.url;
    }
  } catch {
    // Use the Brazilian public record when the country lookup is unavailable.
  }
  return entry.url;
}

module.exports = { regionalShortcutURL };
