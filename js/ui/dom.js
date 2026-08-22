export const $=(s,r=document)=>r.querySelector(s);export const $$=(s,r=document)=>[...r.querySelectorAll(s)];export function text(el,v){if(typeof el==='string')el=$(el);if(el)el.textContent=v??''}
