/* Categorias visíveis de Filmes e Séries + PLAY */
(() => {
  let movies = [], movieCategories = [], series = [], seriesCategories = [];
  let activeMovieCategory = 'all', activeSeriesCategory = 'all';

  function catName(cats,id){const f=cats.find(c=>String(c.category_id)===String(id));return f?(f.category_name||'Sem categoria'):'Sem categoria';}
  function counts(items){const m=new Map();items.forEach(i=>{const id=String(i.category_id??'0');m.set(id,(m.get(id)||0)+1);});return m;}
  function openTv(){ if(typeof openSection==='function') openSection('channels'); }

  function renderCategoryList(type){
    const isMovie=type==='movies', cats=isMovie?movieCategories:seriesCategories, items=isMovie?movies:series;
    const active=isMovie?activeMovieCategory:activeSeriesCategory, box=document.getElementById(isMovie?'moviesCategories':'seriesCategories');
    if(!box)return;
    const cm=counts(items), all=[{category_id:'all',category_name:isMovie?'Todos os filmes':'Todas as séries'},...cats];
    box.innerHTML=all.map(cat=>{const id=String(cat.category_id),total=id==='all'?items.length:(cm.get(id)||0);if(id!=='all'&&total===0)return'';return `<button type="button" class="media-category-button ${id===active?'active':''}" data-category-id="${escapeAttribute(id)}"><span class="folder-icon">📁</span><span class="folder-name">${escapeHTML(cat.category_name||'Sem categoria')}</span><span class="count">${total}</span></button>`;}).join('');
    box.querySelectorAll('.media-category-button').forEach(btn=>btn.addEventListener('click',()=>{if(isMovie)activeMovieCategory=btn.dataset.categoryId;else activeSeriesCategory=btn.dataset.categoryId;renderCategoryList(type);renderMedia(type);}));
  }

  async function playMovie(item){
    if(!activeSession)return;
    const base=String(activeSession.server||'').replace(/\/+$/,'');
    const u=encodeURIComponent(activeSession.username||''),p=encodeURIComponent(activeSession.password||'');
    const ext=String(item.container_extension||'mp4').replace(/^\./,'');
    const url=`${base}/movie/${u}/${p}/${encodeURIComponent(item.stream_id)}.${ext}`;
    openTv();
    if(typeof window.playMediaUrl==='function') await window.playMediaUrl(url,item.name||'Filme','Filme');
  }

  async function playSeries(item){
    if(!activeSession)return;
    try{
      const base=String(activeSession.server||'').replace(/\/+$/,'')+'/';
      const api=new URL('player_api.php',base);
      api.searchParams.set('username',activeSession.username);api.searchParams.set('password',activeSession.password);
      api.searchParams.set('action','get_series_info');api.searchParams.set('series_id',item.series_id);
      const r=await fetch(api.toString(),{cache:'no-store',mode:'cors',credentials:'omit'});if(!r.ok)throw new Error('HTTP '+r.status);
      const data=await r.json();
      const episodes=Object.values(data.episodes||{}).flatMap(v=>Array.isArray(v)?v:[]);
      if(!episodes.length){alert('Nenhum episódio encontrado.');return;}
      const n=prompt(`Esta série possui ${episodes.length} episódio(s). Digite o número do episódio:`,`1`);if(n===null)return;
      const wanted=Math.max(1,parseInt(n,10)||1),ep=episodes.find(e=>Number(e.episode_num)===wanted)||episodes[wanted-1]||episodes[0];
      const ext=String(ep.container_extension||'mp4').replace(/^\./,'');
      const u=encodeURIComponent(activeSession.username||''),p=encodeURIComponent(activeSession.password||'');
      const url=`${String(activeSession.server||'').replace(/\/+$/,'')}/series/${u}/${p}/${encodeURIComponent(ep.id)}.${ext}`;
      openTv();
      if(typeof window.playMediaUrl==='function') await window.playMediaUrl(url,`${item.name||'Série'} - Episódio ${ep.episode_num||wanted}`,'Episódio');
    }catch(e){alert('Não foi possível abrir os episódios desta série: '+(e.message||e));}
  }

  function renderMedia(type){
    const isMovie=type==='movies',items=isMovie?movies:series,cats=isMovie?movieCategories:seriesCategories;
    const active=isMovie?activeMovieCategory:activeSeriesCategory,search=document.getElementById(isMovie?'moviesSearch':'seriesSearch'),grid=document.getElementById(isMovie?'moviesGrid':'seriesGrid');
    if(!grid)return;
    const q=(search?.value||'').toLowerCase().trim();let list=items;
    if(active!=='all')list=list.filter(x=>String(x.category_id)===String(active));if(q)list=list.filter(x=>String(x.name||'').toLowerCase().includes(q));
    const total=list.length;list=list.slice(0,500);const counter=document.getElementById(isMovie?'visibleMovieCount':'visibleSeriesCount');if(counter)counter.textContent=total;
    if(!list.length){grid.innerHTML='<div class="empty-state"><h3>Nada encontrado</h3><p>Escolha outra categoria ou altere a pesquisa.</p></div>';return;}
    grid.innerHTML=list.map((item,index)=>{const raw=item.name||(isMovie?`Filme ${item.stream_id}`:`Série ${item.series_id}`),poster=isMovie?(item.stream_icon||item.cover||''):(item.cover||item.cover_big||'');return `<button class="media-card" type="button" data-index="${index}"><div class="media-poster">${poster?`<img src="${escapeAttribute(poster)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:(isMovie?'🎬':'📚')}</div><strong>${escapeHTML(raw)}</strong><small style="display:block;padding:0 12px 6px;color:#c89585">${escapeHTML(catName(cats,item.category_id))}</small><span style="display:block;padding:0 12px 12px;color:#ff9b35;font-size:11px;font-weight:700">▶ REPRODUZIR</span></button>`;}).join('');
    grid.querySelectorAll('.media-card').forEach(btn=>{const item=list[Number(btn.dataset.index)];btn.addEventListener('click',()=>isMovie?playMovie(item):playSeries(item));});
  }

  async function loadMoviesWithCategories(){if(!activeSession)return;const grid=document.getElementById('moviesGrid'),cats=document.getElementById('moviesCategories');if(grid)grid.innerHTML='<div class="empty-state">Carregando filmes...</div>';if(cats)cats.innerHTML='<div class="empty-state">Carregando categorias...</div>';try{const [items,categories]=await Promise.all([xtreamRequest(activeSession,'get_vod_streams'),xtreamRequest(activeSession,'get_vod_categories').catch(()=>[])]);movies=Array.isArray(items)?items:[];movieCategories=Array.isArray(categories)?categories:[];moviesLoaded=true;setText('movieCount',movies.length);renderCategoryList('movies');renderMedia('movies');}catch(e){if(grid)grid.innerHTML=emptyStateHTML('⚠️','Não foi possível carregar filmes',formatError(e));}}
  async function loadSeriesWithCategories(){if(!activeSession)return;const grid=document.getElementById('seriesGrid'),cats=document.getElementById('seriesCategories');if(grid)grid.innerHTML='<div class="empty-state">Carregando séries...</div>';if(cats)cats.innerHTML='<div class="empty-state">Carregando categorias...</div>';try{const [items,categories]=await Promise.all([xtreamRequest(activeSession,'get_series'),xtreamRequest(activeSession,'get_series_categories').catch(()=>[])]);series=Array.isArray(items)?items:[];seriesCategories=Array.isArray(categories)?categories:[];seriesLoaded=true;setText('seriesCount',series.length);renderCategoryList('series');renderMedia('series');}catch(e){if(grid)grid.innerHTML=emptyStateHTML('⚠️','Não foi possível carregar séries',formatError(e));}}

  window.loadMovies=loadMoviesWithCategories;window.loadSeries=loadSeriesWithCategories;
  document.addEventListener('DOMContentLoaded',()=>{document.getElementById('moviesSearch')?.addEventListener('input',()=>renderMedia('movies'));document.getElementById('seriesSearch')?.addEventListener('input',()=>renderMedia('series'));});
})();
