'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const catalog = globalThis.JSTechCatalog;
  const logos = globalThis.JSTechLogos;
  const categories = [...new Set([
    'Todos', 'Para crianças e jovens', 'Comunicação', 'Redes sociais', 'Entretenimento', 'IA', 'Vídeos', 'Vídeo IA',
    'Animes', 'Imagens & design', 'Compras', 'Serviços & mapas', ...catalog.categories
  ])];
  const categoryName = category => category === 'Pesquisa' ? 'Pesquisas prontas' : category;
  const categoryButtons = new Map();
  const search = $('portal-query');
  const animeButton = $('portal-anime-search');
  const notice = $('portal-notice');
  const pageSize = 24;
  const previewSize = 4;
  const number = new Intl.NumberFormat('pt-BR');
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const textKey = entry => normalize([entry.name, entry.cat, entry.desc, entry.source].join(' '));
  const isDirectLink = entry => entry.kind !== 'search' && entry.kind !== 'telegram-bot';
  const directTitles = new Map([['Pesquisa', 'Atalhos de pesquisa'], ['Privê 18+', 'Abre direto no Aurora']]);
  const entries = catalog.items.map(entry => ({ ...entry, text: textKey(entry) }));
  const animeLink = { name: 'AniList', ico: 'AN', cat: 'Animes', desc: 'Abrir o catálogo mundial de animes', url: 'https://anilist.co/search/anime' };
  const torMessage = 'Endereços .onion precisam do Tor. O Aurora para Windows ainda não tem Tor integrado.';
  let category = 'Todos';
  let page = 1;
  let animeResults = null;
  let animeStatus = '';
  let animeRequest = null;

  $('portal-total').textContent = `${number.format(entries.length)} itens`;
  for (const name of categories) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'portal-category';
    button.textContent = categoryName(name);
    button.onclick = () => selectCategory(name);
    categoryButtons.set(name, button);
    $('portal-categories').append(button);
  }

  function selectedItems() {
    if (category === 'Animes') return animeResults ?? [animeLink];
    const query = normalize(search.value.trim());
    return entries.filter(entry => {
      const inCategory = category === 'Todos' || entry.cat === category || entry.alsoIn === category ||
        (category === 'Pesquisa' && entry.kind === 'search');
      return inCategory && (!query || entry.text.includes(query));
    });
  }

  function openEntry(entry) {
    if (entry.kind === 'tor') { window.alert(torMessage); return; }
    if (entry.adult) {
      const label = entry.cat === 'Jogos' ? 'Apostas e cassino' : 'Conteúdo adulto';
      if (!window.confirm(`${label} 18+. Confirma que você tem 18 anos ou mais?`)) return;
    }
    command('open-shortcut', entry.url);
  }

  function card(entry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'portal-card';
    button.disabled = entry.unavailable === true;
    if (!button.disabled) {
      button.setAttribute('aria-label', `Abrir ${entry.name}`);
      button.onclick = () => openEntry(entry);
    }
    const icon = document.createElement('span');
    icon.className = 'portal-card-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = entry.ico;
    const host = entry.kind === 'tor' ? 'torproject.org' : new URL(entry.url).hostname.replace(/^www\./, '');
    const logoIndex = logos[host];
    if (Number.isInteger(logoIndex)) {
      const mark = document.createElement('span');
      mark.className = 'portal-brand-mark';
      mark.style.backgroundPosition = `${-(logoIndex % 16) * 32}px ${-Math.floor(logoIndex / 16) * 32}px`;
      icon.classList.add('portal-card-icon--brand');
      icon.replaceChildren(mark);
    }
    if (entry.image) {
      const image = document.createElement('img');
      image.alt = '';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      const fallback = [...icon.childNodes];
      image.onerror = () => { icon.replaceChildren(...fallback); };
      image.src = entry.image;
      icon.replaceChildren(image);
    }
    const text = document.createElement('span');
    text.className = 'portal-card-text';
    const title = document.createElement('span');
    title.className = 'portal-card-title';
    title.textContent = entry.name;
    if (entry.adult) {
      const badge = document.createElement('span');
      badge.className = 'portal-age';
      badge.textContent = '18+';
      title.append(badge);
    }
    const description = document.createElement('span');
    description.className = 'portal-card-description';
    description.textContent = entry.desc;
    const category = document.createElement('span');
    category.className = 'portal-card-category';
    category.textContent = entry.kind === 'tor' ? 'Requer Tor' : entry.source || entry.cat;
    text.append(title, description, category);
    button.append(icon, text);
    return button;
  }

  function section(title, entries, group = null, total = entries.length) {
    const block = document.createElement('section');
    block.className = 'portal-section';
    const heading = document.createElement('div');
    heading.className = 'portal-section-heading';
    const name = document.createElement('h2');
    name.textContent = title;
    const count = document.createElement('span');
    count.className = 'portal-section-count';
    count.textContent = number.format(total);
    heading.append(name, count);
    if (group && total > entries.length) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'portal-more';
      more.textContent = 'Ver todos →';
      more.setAttribute('aria-label', `Ver todos em ${title}`);
      more.onclick = () => {
        selectCategory(group);
        $('portal-results').scrollIntoView({ block: 'nearest' });
        categoryButtons.get(group).focus({ preventScroll: true });
      };
      heading.append(more);
    }
    const grid = document.createElement('div');
    grid.className = 'portal-card-grid';
    grid.replaceChildren(...entries.map(card));
    block.append(heading, grid);
    return block;
  }

  function render() {
    const list = selectedItems();
    const pages = Math.max(1, Math.ceil(list.length / pageSize));
    page = Math.min(page, pages);
    const blocks = [];
    if (category === 'Todos') {
      const groups = new Map(categories.slice(1).map(name => [name, []]));
      for (const item of list) {
        groups.get(item.kind === 'search' ? 'Pesquisa' : item.cat).push(item);
        if (item.alsoIn) groups.get(item.alsoIn).push(item);
      }
      for (const [name, group] of groups) {
        if (group.length) blocks.push(section(categoryName(name), group.slice(0, previewSize), name, group.length));
      }
    } else if (list.length) {
      const links = list.filter(isDirectLink);
      const bots = list.filter(item => item.kind === 'telegram-bot');
      const searches = list.filter(item => item.kind === 'search');
      const start = (page - 1) * pageSize;
      const visible = [...links, ...bots, ...searches].slice(start, start + pageSize);
      const visibleLinks = visible.filter(isDirectLink);
      const visibleBots = visible.filter(item => item.kind === 'telegram-bot');
      const visibleSearches = visible.filter(item => item.kind === 'search');
      if (visibleLinks.length) blocks.push(section(directTitles.get(category) ?? categoryName(category), visibleLinks, null, links.length));
      if (visibleBots.length) blocks.push(section('Bots do Telegram', visibleBots, null, bots.length));
      if (visibleSearches.length) blocks.push(section('Pesquisas prontas', visibleSearches, null, searches.length));
    }
    $('portal-grid').replaceChildren(...blocks);
    $('portal-results').textContent = list.length ? `${number.format(list.length)} resultado${list.length === 1 ? '' : 's'}` : 'Nada encontrado. Tente outra pesquisa.';
    $('portal-pager').hidden = category === 'Todos' || pages <= 1;
    $('portal-page').textContent = `Página ${page} de ${pages}`;
    $('portal-prev').disabled = page <= 1;
    $('portal-next').disabled = page >= pages;
    for (const [name, button] of categoryButtons) button.setAttribute('aria-pressed', String(name === category));
    const isAnime = category === 'Animes';
    animeButton.hidden = !isAnime;
    notice.textContent = isAnime ? (animeStatus || 'A consulta é enviada ao AniList quando você clicar em Buscar no AniList.') :
      category === 'Tor / Dark Web' ? torMessage :
      category === 'Jogos' ? 'O Aurora abre o site da operadora quando o país do IP é atendido pelo atalho.' : '';
    notice.hidden = !notice.textContent;
  }

  async function loadAnime() {
    animeRequest?.abort();
    const request = new AbortController();
    animeRequest = request;
    const term = search.value.trim().slice(0, 150);
    animeButton.disabled = true;
    animeStatus = 'Consultando o AniList…';
    render();
    const timeout = setTimeout(() => request.abort(), 8000);
    try {
      const response = await fetch('https://graphql.anilist.co', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          query: 'query ($search: String) { Page(page: 1, perPage: 50) { media(type: ANIME, sort: POPULARITY_DESC, search: $search) { id title { romaji english native } coverImage { large } genres seasonYear format } } }',
          variables: { search: term || null }
        }),
        credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: request.signal
      });
      if (!response.ok) throw new Error('AniList indisponível');
      const data = await response.json();
      const media = data.data?.Page?.media;
      if (!Array.isArray(media)) throw new Error('Resposta inesperada');
      if (animeRequest !== request) return;
      animeResults = media.filter(item => Number.isSafeInteger(item?.id) && item.id > 0).map(item => ({
        name: item.title?.english || item.title?.romaji || item.title?.native || 'Anime',
        ico: 'AN', cat: 'Animes', desc: [item.format, item.seasonYear, item.genres?.slice(0, 3).join(', ')].filter(Boolean).join(' · '),
        url: `https://anilist.co/anime/${item.id}`,
        image: /^https:\/\/s4\.anilist\.co\//.test(item.coverImage?.large || '') ? item.coverImage.large : ''
      }));
      animeStatus = '';
      page = 1;
    } catch {
      if (animeRequest !== request) return;
      animeStatus = 'Não foi possível consultar o AniList agora. Tente novamente ou abra o catálogo.';
      animeResults = [animeLink];
    } finally {
      clearTimeout(timeout);
      if (animeRequest === request) {
        animeRequest = null;
        animeButton.disabled = false;
        render();
      }
    }
  }

  search.addEventListener('input', () => { page = 1; render(); });
  function selectCategory(name) {
    const request = animeRequest;
    animeRequest = null;
    request?.abort();
    animeButton.disabled = false;
    animeStatus = '';
    category = name;
    page = 1;
    render();
  }
  $('portal-search-form').addEventListener('submit', event => {
    event.preventDefault();
    if (category === 'Animes') loadAnime();
  });
  window.addEventListener('aurora-clean-session', () => {
    const request = animeRequest;
    animeRequest = null;
    request?.abort();
    animeResults = null;
    animeStatus = '';
    animeButton.disabled = false;
    category = 'Todos';
    search.value = '';
    page = 1;
    render();
  });
  function changePage(offset) {
    page = Math.max(1, page + offset);
    render();
    $('portal-results').scrollIntoView({ block: 'start' });
  }
  $('portal-prev').onclick = () => changePage(-1);
  $('portal-next').onclick = () => changePage(1);
  render();
})();
