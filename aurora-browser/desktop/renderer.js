'use strict';
const $ = id => document.getElementById(id);
let category = 'web';
async function command(action, value) {
  const result = await window.aurora.command(action, value);
  if (result?.error) { $('error').textContent = result.error; $('error').style.display = 'block'; setTimeout(() => { $('error').style.display = 'none'; }, 5000); }
}
for (const id of ['new', 'back', 'forward', 'reload', 'home', 'clean', 'about']) $(id).onclick = () => command(id);
function navigate(text) { return command('navigate', { text, engine: $('engine').value, category }); }
$('address-form').onsubmit = e => { e.preventDefault(); navigate($('address').value); };
$('search-form').onsubmit = e => { e.preventDefault(); navigate($('query').value); };
document.querySelectorAll('[data-category]').forEach(button => button.onclick = () => {
  category = button.dataset.category;
  document.querySelectorAll('[data-category]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  $('query').focus();
});
window.aurora.onState(state => {
  $('tabs').replaceChildren();
  for (const tab of state.tabs) {
    const item = document.createElement('div'); item.className = 'tab' + (tab.id === state.selected ? ' active' : '');
    const label = document.createElement('button'); label.className = 'label'; label.textContent = (tab.loading ? '↻ ' : '') + tab.title; label.title = tab.url || 'Nova aba'; label.onclick = () => command('select', tab.id);
    const close = document.createElement('button'); close.className = 'close'; close.textContent = '×'; close.setAttribute('aria-label', 'Fechar ' + tab.title); close.onclick = () => command('close', tab.id);
    item.append(label, close); $('tabs').append(item);
  }
  $('start').hidden = !state.home;
  if (document.activeElement !== $('address')) $('address').value = state.home ? '' : state.url;
  $('back').disabled = !state.back; $('forward').disabled = !state.forward;
  $('blocked').textContent = 'Proteção ativa · ' + state.blocked + ' solicitações de rastreadores bloqueadas';
  if (state.home) $('query').focus();
});
document.addEventListener('keydown', event => {
  if (event.ctrlKey && event.key.toLowerCase() === 'l') { event.preventDefault(); $('address').focus(); $('address').select(); }
  if (event.ctrlKey && event.key.toLowerCase() === 't') { event.preventDefault(); command('new'); }
});
window.aurora.onFocus(() => { $('address').focus(); $('address').select(); });
command('ready');
