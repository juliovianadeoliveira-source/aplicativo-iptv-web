export function imageOrFallback(url,fallback='assets/icons/tv.svg'){return url&&/^https?:\/\//i.test(url)?url:fallback}
