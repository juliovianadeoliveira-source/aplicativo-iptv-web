import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
const url=Deno.env.get("SUPABASE_URL")!;
const legacy=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const secretJson=Deno.env.get("SUPABASE_SECRET_KEYS");
const key=secretJson?JSON.parse(secretJson)["default"]:legacy;
if(!key) throw new Error("backend key unavailable");
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const json=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","access-control-allow-origin":"*"}});
async function sha256(s:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,"0")).join("")}
function makeToken(){const b=new Uint8Array(32);crypto.getRandomValues(b);return "jstsync_"+[...b].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function userId(req:Request){const a=req.headers.get("authorization")||"";const t=a.startsWith("Bearer ")?a.slice(7):"";if(!t)return null;const {data,error}=await db.auth.getUser(t);return error?null:data.user?.id||null}
async function ownsWorkspace(uid:string,wid:string){const {data}=await db.from("wa_workspaces").select("id").eq("id",wid).eq("owner_id",uid).maybeSingle();return !!data}
async function sourceOwned(uid:string,id:string){const {data}=await db.from("wa_sync_sources").select("id,workspace_id").eq("id",id).maybeSingle();if(!data)return null;return await ownsWorkspace(uid,data.workspace_id)?data:null}

Deno.serve(async req=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:{"access-control-allow-origin":"*","access-control-allow-headers":"authorization, content-type","access-control-allow-methods":"POST, OPTIONS"}});
  if(req.method!=="POST")return json({error:"method_not_allowed"},405);
  const uid=await userId(req);if(!uid)return json({error:"unauthorized"},401);
  let body:any;try{body=await req.json()}catch{return json({error:"invalid_json"},400)}
  const action=String(body?.action||"create");
  if(action==="create"){
    const wid=String(body?.workspace_id||"");if(!wid||!(await ownsWorkspace(uid,wid)))return json({error:"forbidden"},403);
    const token=makeToken();const tokenHash=await sha256(token);
    const {data,error}=await db.from("wa_sync_sources").insert({workspace_id:wid,name:String(body?.name||"Nova fonte").trim(),source_type:String(body?.source_type||"iptv").trim(),token_hash:tokenHash}).select("id,name,source_type").single();
    if(error)return json({error:error.message},400);
    return json({ok:true,source:data,token,warning:"Guarde este token. Ele só é exibido agora."});
  }
  const id=String(body?.source_id||"");const src=await sourceOwned(uid,id);if(!src)return json({error:"forbidden"},403);
  if(action==="rotate"){
    const token=makeToken();const tokenHash=await sha256(token);const {error}=await db.from("wa_sync_sources").update({token_hash:tokenHash,enabled:true,updated_at:new Date().toISOString()}).eq("id",id);
    if(error)return json({error:error.message},400);return json({ok:true,token,warning:"Guarde este novo token. O anterior parou de funcionar."});
  }
  if(action==="disable"){await db.from("wa_sync_sources").update({enabled:false,updated_at:new Date().toISOString()}).eq("id",id);return json({ok:true})}
  if(action==="enable"){await db.from("wa_sync_sources").update({enabled:true,updated_at:new Date().toISOString()}).eq("id",id);return json({ok:true})}
  return json({error:"unknown_action"},400);
});