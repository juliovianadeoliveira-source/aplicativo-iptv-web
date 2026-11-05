'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const catalog = globalThis.JSTechCatalog;
  const filter = $('portal-category');
  const search = $('portal-query');
  const animeButton = $('portal-anime-search');
  const notice = $('portal-notice');
  const pageSize = 24;
  const number = new Intl.NumberFormat('pt-BR');
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const textKey = entry => normalize([entry.name, entry.cat, entry.desc, entry.source].join(' '));
  const entries = catalog.items.map(entry => ({ ...entry, text: textKey(entry) }));
  const animeLink = { name: 'AniList', ico: 'AN', cat: 'Animes', desc: 'Abrir o catálogo mundial de animes', url: 'https://anilist.co/search/anime' };
  const torMessage = 'Endereços .onion precisam do Tor. O Aurora para Windows ainda não tem Tor integrado.';
  let page = 1;
  let animeResults = null;
  let animeStatus = '';
  let animeRequest = null;

  $('portal-logo').src = catalog.logo;
  $('portal-total').textContent = `${number.format(entries.length)} itens`;
  for (const category of catalog.categories) {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    filter.append(option);
  }

  function selectedItems() {
    if (filter.value === 'Animes') return animeResults ?? [animeLink];
    const query = normalize(search.value.trim());
    return entries.filter(entry => {
      const inCategory = filter.value === 'Todos' || entry.cat === filter.value || (filter.value === 'Pesquisa' && entry.kind === 'search');
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
    button.setAttribute('aria-label', `Abrir ${entry.name}`);
    button.onclick = () => openEntry(entry);
    const icon = document.createElement('span');
    icon.className = 'portal-card-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = entry.ico;
    if (entry.image) {
      const image = document.createElement('img');
      image.alt = '';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.onerror = () => { icon.textContent = entry.ico; };
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

  function render() {
    const list = selectedItems();
    const pages = Math.max(1, Math.ceil(list.length / pageSize));
    page = Math.min(page, pages);
    const start = (page - 1) * pageSize;
    $('portal-grid').replaceChildren(...list.slice(start, start + pageSize).map(card));
    $('portal-results').textContent = list.length ? `${number.format(list.length)} resultado${list.length === 1 ? '' : 's'}` : 'Nada encontrado. Tente outra pesquisa.';
    $('portal-pager').hidden = pages <= 1;
    $('portal-page').textContent = `Página ${page} de ${pages}`;
    $('portal-prev').disabled = page <= 1;
    $('portal-next').disabled = page >= pages;
    const isAnime = filter.value === 'Animes';
    animeButton.hidden = !isAnime;
    notice.textContent = isAnime ? (animeStatus || 'A consulta é enviada ao AniList quando você clicar em Buscar no AniList.') :
      filter.value === 'Tor / Dark Web' ? torMessage : '';
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
  filter.addEventListener('change', () => {
    const request = animeRequest;
    animeRequest = null;
    request?.abort();
    animeButton.disabled = false;
    animeStatus = '';
    page = 1;
    render();
  });
  $('portal-search-form').addEventListener('submit', event => {
    event.preventDefault();
    if (filter.value === 'Animes') loadAnime();
  });
  window.addEventListener('aurora-clean-session', () => {
    const request = animeRequest;
    animeRequest = null;
    request?.abort();
    animeResults = null;
    animeStatus = '';
    animeButton.disabled = false;
    filter.value = 'Todos';
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
