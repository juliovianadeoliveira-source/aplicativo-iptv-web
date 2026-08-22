export function byCategory(channels,id){return id==='all'?channels:channels.filter(x=>String(x.category_id)===String(id))}
export function searchChannels(channels,q){q=(q||'').trim().toLowerCase();return !q?channels:channels.filter(x=>String(x.name||'').toLowerCase().includes(q))}
