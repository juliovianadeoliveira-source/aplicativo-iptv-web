/* Categorias visíveis de Filmes e Séries */
(() => {
  let movies = [];
  let movieCategories = [];
  let series = [];
  let seriesCategories = [];
  let activeMovieCategory = 'all';
  let activeSeriesCategory = 'all';

  function catName(cats, id) {
    const found = cats.find(c => String(c.category_id) === String(id));
    return found ? (found.category_name || 'Sem categoria') : 'Sem categoria';
  }

  function counts(items) {
    const map = new Map();
    items.forEach(item => {
      const id = String(item.category_id ?? '0');
      map.set(id, (map.get(id) || 0) + 1);
    });
    return map;
  }

  function renderCategoryList(type) {
    const isMovie = type === 'movies';
    const cats = isMovie ? movieCategories : seriesCategories;
    const items = isMovie ? movies : series;
    const active = isMovie ? activeMovieCategory : activeSeriesCategory;
    const box = document.getElementById(isMovie ? 'moviesCategories' : 'seriesCategories');
    if (!box) return;

    const countMap = counts(items);
    const all = [{ category_id: 'all', category_name: isMovie ? 'Todos os filmes' : 'Todas as séries' }, ...cats];
    box.innerHTML = all.map(cat => {
      const id = String(cat.category_id);
      const total = id === 'all' ? items.length : (countMap.get(id) || 0);
      if (id !== 'all' && total === 0) return '';
      return `<button type="button" class="media-category-button ${id === active ? 'active' : ''}" data-media-type="${type}" data-category-id="${escapeAttribute(id)}">
        <span class="folder-icon">📁</span>
        <span class="folder-name">${escapeHTML(cat.category_name || 'Sem categoria')}</span>
        <span class="count">${total}</span>
      </button>`;
    }).join('');

    box.querySelectorAll('.media-category-button').forEach(btn => {
      btn.addEventListener('click', () => {
        if (isMovie) activeMovieCategory = btn.dataset.categoryId;
        else activeSeriesCategory = btn.dataset.categoryId;
        renderCategoryList(type);
        renderMedia(type);
      });
    });
  }

  function renderMedia(type) {
    const isMovie = type === 'movies';
    const items = isMovie ? movies : series;
    const cats = isMovie ? movieCategories : seriesCategories;
    const active = isMovie ? activeMovieCategory : activeSeriesCategory;
    const search = document.getElementById(isMovie ? 'moviesSearch' : 'seriesSearch');
    const grid = document.getElementById(isMovie ? 'moviesGrid' : 'seriesGrid');
    if (!grid) return;

    const q = (search?.value || '').toLowerCase().trim();
    let list = items;
    if (active !== 'all') list = list.filter(x => String(x.category_id) === String(active));
    if (q) list = list.filter(x => String(x.name || '').toLowerCase().includes(q));

    const total = list.length;
    list = list.slice(0, 500);
    const counter = document.getElementById(isMovie ? 'visibleMovieCount' : 'visibleSeriesCount');
    if (counter) counter.textContent = total;

    if (!list.length) {
      grid.innerHTML = `<div class="empty-state"><h3>Nada encontrado</h3><p>Escolha outra categoria ou altere a pesquisa.</p></div>`;
      return;
    }

    grid.innerHTML = list.map(item => {
      const raw = item.name || (isMovie ? `Filme ${item.stream_id}` : `Série ${item.series_id}`);
      const poster = isMovie ? (item.stream_icon || item.cover || '') : (item.cover || item.cover_big || '');
      return `<button class="media-card" type="button">
        <div class="media-poster">${poster ? `<img src="${escapeAttribute(poster)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : (isMovie ? '🎬' : '📚')}</div>
        <strong>${escapeHTML(raw)}</strong>
        <small style="display:block;padding:0 12px 12px;color:#c89585">${escapeHTML(catName(cats, item.category_id))}</small>
      </button>`;
    }).join('');
  }

  async function loadMoviesWithCategories() {
    if (!activeSession) return;
    const grid = document.getElementById('moviesGrid');
    const cats = document.getElementById('moviesCategories');
    if (grid) grid.innerHTML = '<div class="empty-state">Carregando filmes...</div>';
    if (cats) cats.innerHTML = '<div class="empty-state">Carregando categorias...</div>';
    try {
      const [items, categories] = await Promise.all([
        xtreamRequest(activeSession, 'get_vod_streams'),
        xtreamRequest(activeSession, 'get_vod_categories').catch(() => [])
      ]);
      movies = Array.isArray(items) ? items : [];
      movieCategories = Array.isArray(categories) ? categories : [];
      moviesLoaded = true;
      setText('movieCount', movies.length);
      renderCategoryList('movies');
      renderMedia('movies');
    } catch (e) {
      if (grid) grid.innerHTML = emptyStateHTML('⚠️', 'Não foi possível carregar filmes', formatError(e));
    }
  }

  async function loadSeriesWithCategories() {
    if (!activeSession) return;
    const grid = document.getElementById('seriesGrid');
    const cats = document.getElementById('seriesCategories');
    if (grid) grid.innerHTML = '<div class="empty-state">Carregando séries...</div>';
    if (cats) cats.innerHTML = '<div class="empty-state">Carregando categorias...</div>';
    try {
      const [items, categories] = await Promise.all([
        xtreamRequest(activeSession, 'get_series'),
        xtreamRequest(activeSession, 'get_series_categories').catch(() => [])
      ]);
      series = Array.isArray(items) ? items : [];
      seriesCategories = Array.isArray(categories) ? categories : [];
      seriesLoaded = true;
      setText('seriesCount', series.length);
      renderCategoryList('series');
      renderMedia('series');
    } catch (e) {
      if (grid) grid.innerHTML = emptyStateHTML('⚠️', 'Não foi possível carregar séries', formatError(e));
    }
  }

  window.loadMovies = loadMoviesWithCategories;
  window.loadSeries = loadSeriesWithCategories;

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('moviesSearch')?.addEventListener('input', () => renderMedia('movies'));
    document.getElementById('seriesSearch')?.addEventListener('input', () => renderMedia('series'));
  });
})();