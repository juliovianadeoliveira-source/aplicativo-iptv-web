import { storage } from '../core/storage.js';
const defaults={autoplay:true,rememberVolume:true,gridSize:'medium',language:'pt-BR'};
export function getSettings(){return {...defaults,...storage.get('settings',{})}}
export function saveSettings(next){const v={...getSettings(),...next};storage.set('settings',v);return v}
