import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const cors={"access-control-allow-origin":"*","access-control-allow-headers":"authorization, x-client-info, apikey, content-type"};
const json=(d:any,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...cors,"content-type":"application/json; charset=utf-8"}});
const URL=Deno.env.get("SUPABASE_URL")!;
const legacy=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const sj=Deno.env.get("SUPABASE_SECRET_KEYS");
const SERVICE=sj?JSON.parse(sj)["default"]:legacy;
if(!SERVICE)throw new Error("backend key unavailable");
const db=createClient(URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"method_not_allowed"},405);
  const jwt=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!jwt)return json({error:"unauthorized"},401);
  const {data:au,error:ae}=await db.auth.getUser(jwt);
  const user=au?.user;
  if(ae||!user)return json({error:"unauthorized"},401);

  let b:any={};
  try{b=await req.json()}catch{return json({error:"invalid_json"},400)}
  const wid=String(b?.workspace_id||"");
  const campaignId=String(b?.campaign_id||"");
  if(!wid||!campaignId)return json({error:"workspace_and_campaign_required"},400);

  const {data:w}=await db.from("wa_workspaces").select("id,owner_id").eq("id",wid).maybeSingle();
  if(!w||w.owner_id!==user.id)return json({error:"forbidden"},403);

  const {data:camp}=await db.from("wa_campaigns")
    .select("id,name,message,enabled,image_data_uri")
    .eq("id",campaignId).eq("workspace_id",wid).maybeSingle();
  if(!camp)return json({error:"campaign_not_found"},404);
  if(!String(camp.message||"").trim())return json({error:"empty_message"},400);

  const {data:s}=await db.from("wa_settings").select("bridge_connected").eq("workspace_id",wid).maybeSingle();
  if(!s?.bridge_connected)return json({error:"whatsapp_not_connected"},409);

  const {count,error:ec}=await db.from("wa_contacts")
    .select("id",{count:"exact",head:true})
    .eq("workspace_id",wid).eq("marketing_opt_in",true).is("marketing_opt_out_at",null);
  if(ec)return json({error:"eligible_count_failed"},500);

  const {data:queued,error}=await db.rpc("queue_wa_campaign_now",{p_workspace_id:wid,p_campaign_id:campaignId});
  if(error)return json({error:"queue_failed",message:error.message},500);
  const total=Number(queued||0);
  return json({ok:true,queued:total,eligible:count,already_sent_today:total===0});
});