export function normalize(text=''){return text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()}
export function matches(item,q,fields=['name']){q=normalize(q);return !q||fields.some(f=>normalize(item?.[f]||'').includes(q))}
