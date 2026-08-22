import { storage } from '../core/storage.js';
const KEY='history';
export function addHistory(item){const list=storage.get(KEY,[]).filter(x=>!(x.type===item.type&&String(x.id)===String(item.id)));list.unshift({...item,playedAt:Date.now()});storage.set(KEY,list.slice(0,100));return list}
export function history(){return storage.get(KEY,[])}
