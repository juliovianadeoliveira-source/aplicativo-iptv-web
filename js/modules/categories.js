export function categoryCounts(channels){return channels.reduce((m,c)=>{const k=String(c.category_id??'0');m[k]=(m[k]||0)+1;return m},{})}
