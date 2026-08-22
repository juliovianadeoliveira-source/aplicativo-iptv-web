const bus=new EventTarget();
export const events={on:(n,fn)=>bus.addEventListener(n,fn),off:(n,fn)=>bus.removeEventListener(n,fn),emit:(n,detail)=>bus.dispatchEvent(new CustomEvent(n,{detail}))};
