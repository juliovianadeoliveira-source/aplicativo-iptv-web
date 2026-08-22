export async function getSeriesInfo(api,id){return api.request('get_series_info',{series_id:id})}
export function flattenEpisodes(data){return Object.values(data?.episodes||{}).flatMap(v=>Array.isArray(v)?v:[])}
