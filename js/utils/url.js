export function normalizeServer(value){const u=new URL(value);if(!['http:','https:'].includes(u.protocol))throw new Error('URL precisa usar HTTP ou HTTPS');return u.origin}
export function switchProtocol(value){return /^https:\/\//i.test(value)?value.replace(/^https:/i,'http:'):value.replace(/^http:/i,'https:')}
