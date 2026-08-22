export function bindKeyboard({escape,enter}={}){document.addEventListener('keydown',e=>{if(e.key==='Escape'&&escape)escape(e);if(e.key==='Enter'&&enter)enter(e)})}
