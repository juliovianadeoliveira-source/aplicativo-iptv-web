const prefix='iptv:';
export const storage={get(k,f=null){try{const v=localStorage.getItem(prefix+k);return v===null?f:JSON.parse(v)}catch{return f}},set(k,v){localStorage.setItem(prefix+k,JSON.stringify(v));return v},remove(k){localStorage.removeItem(prefix+k)},clear(){Object.keys(localStorage).filter(k=>k.startsWith(prefix)).forEach(k=>localStorage.removeItem(k))}};
