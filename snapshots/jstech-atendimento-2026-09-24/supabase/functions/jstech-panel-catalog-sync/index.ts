
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const URL=Deno.env.get("SUPABASE_URL")!;
const legacy=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const sj=Deno.env.get("SUPABASE_SECRET_KEYS");
const SERVICE=sj?JSON.parse(sj)["default"]:legacy;
if(!SERVICE) throw new Error("backend key unavailable");
const db=createClient(URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
const MASTER_WID="71634450-2a93-4796-a0fa-d3e2d534502f";
const CATALOG_URL="https://multi-paineis.sytes.net/";
const json=(d:any,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8","access-control-allow-origin":"*"}});

function normalizeUrl(v:string){
  const s=String(v||"").trim();
  if(!s)return null;
  if(/^https?:\/\//i.test(s))return s;
  if(s.startsWith("/"))return new URL(s,CATALOG_URL).toString();
  return null;
}
function parsePairs(block:string){
  const out:{name:string,url:string|null}[]=[];
  const seen=new Set<string>();
  const re=/\[\s*['"]([^'"]{2,120})['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*\]/g;
  let m;
  while((m=re.exec(block))!==null){
    const name=String(m[1]||"").trim();
    const login=normalizeUrl(String(m[4]||""));
    if(!name||seen.has(name.toLowerCase()))continue;
    seen.add(name.toLowerCase());
    out.push({name,url:login});
  }
  return out;
}
function slug(v:string){
  return v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,80);
}

Deno.serve(async req=>{
  if(!["GET","POST"].includes(req.method))return json({error:"method_not_allowed"},405);
  try{
    const res=await fetch(CATALOG_URL,{headers:{"user-agent":"JSTechPanelCatalog/1.0","accept":"text/html"}});
    if(!res.ok)return json({error:"catalog_http_"+res.status},502);
    const html=await res.text();
    const block=(html.match(/const\s+panels\s*=\s*\[([\s\S]*?)\];/)||[])[1]||"";
    if(!block)return json({error:"panels_block_not_found"},502);

    const panels=parsePairs(block);
    if(!panels.length)return json({error:"no_panels_found"},502);

    const {data:existing}=await db.from("wa_panel_connectors")
      .select("id,name,credential_secret_id,enabled,base_url")
      .eq("workspace_id",MASTER_WID);
    const byName=new Map((existing||[]).map((x:any)=>[String(x.name).toLowerCase(),x]));

    let inserted=0,updated=0;
    for(const p of panels){
      const found:any=byName.get(p.name.toLowerCase());
      if(found){
        const patch:any={catalog_source:CATALOG_URL,catalog_key:slug(p.name),updated_at:new Date().toISOString()};
        if(p.url)patch.base_url=p.url;
        await db.from("wa_panel_connectors").update(patch).eq("id",found.id);
        updated++;
      }else{
        await db.from("wa_panel_connectors").insert({
          workspace_id:MASTER_WID,
          name:p.name,
          provider_type:"iptv",
          driver_type:"browser",
          base_url:p.url,
          catalog_source:CATALOG_URL,
          catalog_key:slug(p.name),
          capabilities:["test","create_user","renew"],
          enabled:false,
          last_status:"aguardando_credenciais"
        });
        inserted++;
      }
    }

    return json({ok:true,found:panels.length,inserted,updated,panels:panels.map(p=>({name:p.name,has_url:!!p.url}))});
  }catch(e:any){
    return json({error:"sync_failed",detail:String(e?.message||e)},500);
  }
});
