const KEY='iptvSession';
export function getSession(){for(const s of [localStorage,sessionStorage]){try{const v=s.getItem(KEY);if(v)return JSON.parse(v)}catch{}}return null}
export function saveSession(v,remember=false){localStorage.removeItem(KEY);sessionStorage.removeItem(KEY);(remember?localStorage:sessionStorage).setItem(KEY,JSON.stringify(v));}
export function clearSession(){localStorage.removeItem(KEY);sessionStorage.removeItem(KEY);}
