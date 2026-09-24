import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const url=Deno.env.get("SUPABASE_URL")!;
const legacy=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const secretJson=Deno.env.get("SUPABASE_SECRET_KEYS");
const key=secretJson?JSON.parse(secretJson)["default"]:legacy;
if(!key) throw new Error("backend key unavailable");
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});

const json=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8"}});
const cleanDate=(v:any)=>{const s=String(v||"").slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:null};
const cleanNum=(v:any)=>{if(v===null||v===undefined||v==="")return null;const n=Number(String(v).replace(",", "."));return Number.isFinite(n)?n:null};
async function sha256(s:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,"0")).join("")}

Deno.serve(async req=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:{"access-control-allow-origin":"*","access-control-allow-headers":"authorization, content-type","access-control-allow-methods":"POST, OPTIONS"}});
  if(req.method!=="POST") return json({error:"method_not_allowed"},405);
  const auth=req.headers.get("authorization")||"";
  const token=auth.startsWith("Bearer ")?auth.slice(7).trim():"";
  if(!token.startsWith("jstsync_")) return json({error:"invalid_token"},401);
  const tokenHash=await sha256(token);
  const {data:source,error:srcErr}=await db.from("wa_sync_sources").select("*").eq("token_hash",tokenHash).eq("enabled",true).maybeSingle();
  if(srcErr||!source) return json({error:"source_not_found"},401);

  let body:any;try{body=await req.json()}catch{return json({error:"invalid_json"},400)}
  const clients=Array.isArray(body?.clients)?body.clients:null;
  if(!clients) return json({error:"clients_required"},400);
  if(clients.length>5000) return json({error:"too_many_clients",max:5000},413);
  const runId=crypto.randomUUID();
  const seen=new Set<string>();
  const rows:any[]=[];
  for(const item of clients){
    const externalId=String(item?.external_id??item?.id??item?.username??item?.phone??"").trim();
    if(!externalId||seen.has(externalId)) continue;
    seen.add(externalId);
    rows.push({
      workspace_id:source.workspace_id,source_id:source.id,external_id:externalId,
      name:String(item?.name??item?.nome??"").trim()||null,
      phone:String(item?.phone??item?.telefone??"").replace(/\D/g,"")||null,
      service_type:String(item?.service_type??item?.servico??source.source_type??"").trim()||null,
      device_type:String(item?.device_type??item?.aparelho??"").trim()||null,
      app_name:String(item?.app_name??item?.app??item?.aplicativo??"").trim()||null,
      login_username:String(item?.login_username??item?.username??item?.usuario??"").trim()||null,
      expires_at:cleanDate(item?.expires_at??item?.due_date??item?.vencimento),
      amount:cleanNum(item?.amount??item?.valor),
      status:String(item?.status??"").trim()||null,
      notes:String(item?.notes??item?.observacoes??item?.obs??"").trim()||null,
      raw_data:item&&typeof item==="object"?item:{},
      synced_at:new Date().toISOString(),active:true,sync_run_id:runId
    });
  }
  for(let i=0;i<rows.length;i+=500){
    const {error}=await db.from("wa_external_clients").upsert(rows.slice(i,i+500),{onConflict:"source_id,external_id"});
    if(error){
      await db.from("wa_sync_sources").update({last_error:error.message,updated_at:new Date().toISOString()}).eq("id",source.id);
      return json({error:"upsert_failed"},500);
    }
  }
  if(body?.full_sync===true){
    await db.from("wa_external_clients").update({active:false}).eq("source_id",source.id).neq("sync_run_id",runId);
  }
  await db.from("wa_sync_sources").update({last_synced_at:new Date().toISOString(),last_error:null,record_count:rows.length,updated_at:new Date().toISOString()}).eq("id",source.id);
  return json({ok:true,source:source.name,received:clients.length,synced:rows.length,run_id:runId});
});