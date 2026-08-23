/* Filmes e Séries: categorias, pesquisa e players próprios */
(() => {
  let movies=[],movieCategories=[],series=[],seriesCategories=[];
  let activeMovieCategory='all',activeSeriesCategory='all';

  function catName(cats,id){const f=cats.find(c=>String(c.category_id)===String(id));return f?(f.category_name||'Sem categoria'):'Sem categoria';}
  function counts(items){const m=new Map();items.forEach(i=>{const id=String(i.category_id??'0');m.set(id,(m.get(id)||0)+1);});return m;}
  function esc(v){return typeof escapeHTML==='function'?escapeHTML(v):String(v??'');}
  function attr(v){return typeof escapeAttribute==='function'?escapeAttribute(v):String(v??'').replace(/"/g,'&quot;');}

  function ensureMediaPlayer(type){
    const isMovie=type==='movies';
    const section=document.getElementById(isMovie?'moviesSection':'seriesSection');
    const results=section?.querySelector('.media-results');
    if(!results)return null;
    const id=isMovie?'moviePlayerPanel':'seriesPlayerPanel';
    let panel=document.getElementById(id);
    if(panel)return panel;
    panel=document.createElement('div');panel.id=id;
    panel.style.cssText='display:none;margin-bottom:16px;border:1px solid rgba(255,130,60,.22);border-radius:18px;overflow:hidden;background:#090202;box-shadow:0 18px 50px rgba(0,0,0,.25)';
    const prefix=isMovie?'movie':'series';
    panel.innerHTML=`
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:linear-gradient(180deg,rgba(99,17,7,.75),rgba(34,7,4,.8));border-bottom:1px solid rgba(255,130,60,.22)">
        <div><small style="display:block;color:#cf9b8d;font-size:9px">${isMovie?'FILME':'EPISÓDIO'}</small><strong id="${prefix}PlayerTitle" style="display:block;margin-top:4px;font-size:13px">Selecione ${isMovie?'um filme':'um episódio'}</strong></div>
        <span style="font-size:9px;background:#e8440e;padding:6px 9px;border-radius:20px">▶ PLAY</span>
      </div>
      <div style="background:#000;aspect-ratio:16/9;min-height:300px"><video id="${prefix}VideoPlayer" controls playsinline preload="metadata" style="width:100%;height:100%;display:block;background:#000"></video></div>
      <div id="${prefix}PlayerStatus" style="padding:10px 14px;color:#c8a096;font-size:10px;border-top:1px solid rgba(255,130,60,.22)">Pronto para reproduzir.</div>`;
    results.insertBefore(panel,results.firstChild);
    return panel;
  }

  function renderCategoryList(type){
    const isMovie=type==='movies',cats=isMovie?movieCategories:seriesCategories,items=isMovie?movies:series;
    const active=isMovie?activeMovieCategory:activeSeriesCategory,box=document.getElementById(isMovie?'moviesCategories':'seriesCategories');if(!box)return;
    const cm=counts(items),all=[{category_id:'all',category_name:isMovie?'Todos os filmes':'Todas as séries'},...cats];
    box.innerHTML=all.map(cat=>{const id=String(cat.category_id),total=id==='all'?items.length:(cm.get(id)||0);if(id!=='all'&&total===0)return'';return `<button type="button" class="media-category-button ${id===active?'active':''}" data-category-id="${attr(id)}"><span class="folder-icon">📁</span><span class="folder-name">${esc(cat.category_name||'Sem categoria')}</span><span class="count">${total}</span></button>`;}).join('');
    box.querySelectorAll('.media-category-button').forEach(btn=>btn.addEventListener('click',()=>{if(isMovie)activeMovieCategory=btn.dataset.categoryId;else activeSeriesCategory=btn.dataset.categoryId;renderCategoryList(type);renderMedia(type);}));
  }

  async function playMovie(item){
    if(!activeSession||!item)return;
    const panel=ensureMediaPlayer('movies');if(!panel)return;panel.style.display='block';panel.scrollIntoView({behavior:'smooth',block:'start'});
    const ext=String(item.container_extension||'mp4').replace(/^\./,'');
    if(typeof window.playXtreamMedia==='function'){
      await window.playXtreamMedia('movie',activeSession,item.stream_id,ext,item.name||'Filme',{videoId:'movieVideoPlayer',statusId:'moviePlayerStatus',titleId:'moviePlayerTitle'});
    }
  }

  async function fetchSeriesInfo(seriesId){
    const base=String(activeSession.server||'').replace(/\/+$/,'')+'/';
    const api=new URL('player_api.php',base);api.searchParams.set('username',activeSession.username);api.searchParams.set('password',activeSession.password);api.searchParams.set('action','get_series_info');api.searchParams.set('series_id',seriesId);
    const r=await fetch(api.toString(),{cache:'no-store',mode:'cors',credentials:'omit'});if(!r.ok)throw new Error('HTTP '+r.status);return r.json();
  }

  function ensureEpisodeBrowser(){
    const panel=ensureMediaPlayer('series');if(!panel)return null;
    let box=document.getElementById('seriesEpisodeBrowser');
    if(!box){box=document.createElement('div');box.id='seriesEpisodeBrowser';box.style.cssText='padding:12px 14px;background:rgba(35,7,4,.95);border-top:1px solid rgba(255,130,60,.18)';panel.appendChild(box);}
    return box;
  }

  function episodeGroups(data){
    const raw=data?.episodes||{};const groups=[];
    if(Array.isArray(raw)){groups.push({season:'1',episodes:raw});return groups;}
    Object.keys(raw).sort((a,b)=>Number(a)-Number(b)).forEach(k=>{const eps=Array.isArray(raw[k])?raw[k]:[];if(eps.length)groups.push({season:k,episodes:eps});});
    return groups;
  }

  async function openSeries(item){
    if(!activeSession||!item)return;
    const panel=ensureMediaPlayer('series'),box=ensureEpisodeBrowser();if(!panel||!box)return;panel.style.display='block';box.innerHTML='<div style="color:#d9a596;font-size:11px">Carregando temporadas e episódios...</div>';panel.scrollIntoView({behavior:'smooth',block:'start'});
    try{
      const data=await fetchSeriesInfo(item.series_id),groups=episodeGroups(data);
      if(!groups.length){box.innerHTML='<div style="color:#ff9582">Nenhum episódio encontrado.</div>';return;}
      box.innerHTML=`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">${groups.map((g,i)=>`<button type="button" class="season-tab" data-season-index="${i}" style="border:1px solid rgba(255,130,60,.22);background:${i===0?'#7b210d':'#32100a'};color:#fff;border-radius:9px;padding:8px 10px;cursor:pointer">Temporada ${esc(g.season)}</button>`).join('')}</div><div id="episodeList"></div>`;
      const renderEpisodes=index=>{
        box.querySelectorAll('.season-tab').forEach((b,i)=>b.style.background=i===index?'#7b210d':'#32100a');
        const list=box.querySelector('#episodeList'),g=groups[index];
        list.innerHTML=`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px">${g.episodes.map((ep,i)=>`<button type="button" class="episode-btn" data-episode-index="${i}" style="text-align:left;border:1px solid rgba(255,130,60,.18);background:#1d0805;color:#fff;border-radius:10px;padding:10px;cursor:pointer"><strong style="display:block;font-size:11px">Episódio ${esc(ep.episode_num||i+1)}</strong><small style="display:block;margin-top:4px;color:#c89585;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(ep.title||ep.info?.name||item.name||'Série')}</small></button>`).join('')}</div>`;
        list.querySelectorAll('.episode-btn').forEach(btn=>btn.addEventListener('click',async()=>{
          const ep=g.episodes[Number(btn.dataset.episodeIndex)],ext=String(ep.container_extension||'mp4').replace(/^\./,'');
          const title=`${item.name||'Série'} - T${g.season} E${ep.episode_num||Number(btn.dataset.episodeIndex)+1}`;
          if(typeof window.playXtreamMedia==='function')await window.playXtreamMedia('series',activeSession,ep.id,ext,title,{videoId:'seriesVideoPlayer',statusId:'seriesPlayerStatus',titleId:'seriesPlayerTitle'});
        }));
      };
      box.querySelectorAll('.season-tab').forEach(btn=>btn.addEventListener('click',()=>renderEpisodes(Number(btn.dataset.seasonIndex))));renderEpisodes(0);
    }catch(e){box.innerHTML='<div style="color:#ff9582">Não foi possível carregar episódios: '+esc(e.message||e)+'</div>';}
  }

  function renderMedia(type){
    const isMovie=type==='movies',items=isMovie?movies:series,cats=isMovie?movieCategories:seriesCategories;
    const active=isMovie?activeMovieCategory:activeSeriesCategory,search=document.getElementById(isMovie?'moviesSearch':'seriesSearch'),grid=document.getElementById(isMovie?'moviesGrid':'seriesGrid');if(!grid)return;
    const q=(search?.value||'').toLowerCase().trim();let list=items;if(active!=='all')list=list.filter(x=>String(x.category_id)===String(active));if(q)list=list.filter(x=>String(x.name||'').toLowerCase().includes(q));
    const total=list.length;list=list.slice(0,500);const counter=document.getElementById(isMovie?'visibleMovieCount':'visibleSeriesCount');if(counter)counter.textContent=total;
    if(!list.length){grid.innerHTML='<div class="empty-state"><h3>Nada encontrado</h3><p>Escolha outra categoria ou altere a pesquisa.</p></div>';return;}
    grid.innerHTML=list.map((item,index)=>{const raw=item.name||(isMovie?`Filme ${item.stream_id}`:`Série ${item.series_id}`),poster=isMovie?(item.stream_icon||item.cover||''):(item.cover||item.cover_big||'');return `<button class="media-card" type="button" data-index="${index}"><div class="media-poster">${poster?`<img src="${attr(poster)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:(isMovie?'🎬':'📚')}</div><strong>${esc(raw)}</strong><small style="display:block;padding:0 12px 6px;color:#c89585">${esc(catName(cats,item.category_id))}</small><span style="display:block;padding:0 12px 12px;color:#ff9b35;font-size:11px;font-weight:700">${isMovie?'▶ REPRODUZIR':'▶ VER EPISÓDIOS'}</span></button>`;}).join('');
    grid.querySelectorAll('.media-card').forEach(btn=>{const item=list[Number(btn.dataset.index)];btn.addEventListener('click',()=>isMovie?playMovie(item):openSeries(item));});
  }

  async function loadMoviesWithCategories(){if(!activeSession)return;const grid=document.getElementById('moviesGrid'),cats=document.getElementById('moviesCategories');if(grid)grid.innerHTML='<div class="empty-state">Carregando filmes...</div>';if(cats)cats.innerHTML='<div class="empty-state">Carregando categorias...</div>';try{const [items,categories]=await Promise.all([xtreamRequest(activeSession,'get_vod_streams'),xtreamRequest(activeSession,'get_vod_categories').catch(()=>[])]);movies=Array.isArray(items)?items:[];movieCategories=Array.isArray(categories)?categories:[];moviesLoaded=true;setText('movieCount',movies.length);renderCategoryList('movies');renderMedia('movies');}catch(e){if(grid)grid.innerHTML=emptyStateHTML('⚠️','Não foi possível carregar filmes',formatError(e));}}
  async function loadSeriesWithCategories(){if(!activeSession)return;const grid=document.getElementById('seriesGrid'),cats=document.getElementById('seriesCategories');if(grid)grid.innerHTML='<div class="empty-state">Carregando séries...</div>';if(cats)cats.innerHTML='<div class="empty-state">Carregando categorias...</div>';try{const [items,categories]=await Promise.all([xtreamRequest(activeSession,'get_series'),xtreamRequest(activeSession,'get_series_categories').catch(()=>[])]);series=Array.isArray(items)?items:[];seriesCategories=Array.isArray(categories)?categories:[];seriesLoaded=true;setText('seriesCount',series.length);renderCategoryList('series');renderMedia('series');}catch(e){if(grid)grid.innerHTML=emptyStateHTML('⚠️','Não foi possível carregar séries',formatError(e));}}

  window.loadMovies=loadMoviesWithCategories;window.loadSeries=loadSeriesWithCategories;
  document.addEventListener('DOMContentLoaded',()=>{ensureMediaPlayer('movies');ensureMediaPlayer('series');document.getElementById('moviesSearch')?.addEventListener('input',()=>renderMedia('movies'));document.getElementById('seriesSearch')?.addEventListener('input',()=>renderMedia('series'));});
})();
