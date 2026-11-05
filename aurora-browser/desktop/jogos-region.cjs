'use strict';

const COUNTRY_TRACE = 'https://www.cloudflare.com/cdn-cgi/trace';

async function regionalShortcut(entry, session, signal) {
  try {
    const response = await session.fetch(COUNTRY_TRACE, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(4500)]),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error'
    });
    if (response.ok) {
      const country = /^loc=([A-Z]{2})\r?$/m.exec(await response.text())?.[1];
      if (country && country !== 'XX') {
        return { country, url: entry.regionalUrls[country] ?? null };
      }
    }
  } catch {
    // An unavailable country lookup cannot establish a regional destination.
  }
  return { country: null, url: null };
}

module.exports = { regionalShortcut };
