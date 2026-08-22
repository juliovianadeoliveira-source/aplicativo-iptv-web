import { storage } from '../core/storage.js';
const KEY='favorites';
export function allFavorites(){return storage.get(KEY,[])}
export function isFavorite(type,id){return allFavorites().some(x=>x.type===type&&String(x.id)===String(id))}
export function toggleFavorite(item){const list=allFavorites();const i=list.findIndex(x=>x.type===item.type&&String(x.id)===String(item.id));if(i>=0)list.splice(i,1);else list.unshift(item);storage.set(KEY,list);return list}
