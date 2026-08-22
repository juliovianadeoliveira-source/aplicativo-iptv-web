export const state={session:null,channels:[],movies:[],series:[],categories:[],activeCategory:'all',search:''};
export function patchState(next){Object.assign(state,next);return state;}
