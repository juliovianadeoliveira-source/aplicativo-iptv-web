export function go(page){window.location.href=page;}
export function current(){return location.pathname.split('/').pop()||'index.html';}
