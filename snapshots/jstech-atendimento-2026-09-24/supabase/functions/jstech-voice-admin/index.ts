import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}")["default"];
if(!service)throw new Error("service_key_missing");
const db=createClient(SUPABASE_URL,service,{auth:{persistSession:false,autoRefreshToken:false}});

const json=(data:any,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{"content-type":"application/json; charset=utf-8"}
});

async function providerKeyStatus(workspaceId:string){
  let current=workspaceId;
  for(let level=0;level<3&&current;level++){
    const {data:key}=await db.rpc("voice_agent_get_elevenlabs_api_key",{p_workspace_id:current});
    if(String(key||"").trim())return {available:true,inherited:current!==workspaceId};
    const {data:ws}=await db.from("wa_workspaces")
      .select("parent_workspace_id").eq("id",current).maybeSingle();
    current=String(ws?.parent_workspace_id||"").trim();
  }
  const envKey=String(Deno.env.get("ELEVENLABS_API_KEY")||"").trim();
  if(envKey)return {available:true,inherited:true};
  return {available:false,inherited:false};
}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({error:"method_not_allowed"},405);
  const auth=req.headers.get("authorization")||"";
  const token=auth.replace(/^Bearer\s+/i,"").trim();
  if(!token)return json({error:"unauthorized"},401);

  const {data:{user},error:userErr}=await db.auth.getUser(token);
  if(userErr||!user)return json({error:"unauthorized"},401);

  let b:any={};
  try{b=await req.json()}catch{return json({error:"invalid_json"},400)}
  const workspaceId=String(b?.workspace_id||"").trim();
  if(!workspaceId)return json({error:"workspace_required"},400);

  const {data:workspace}=await db.from("wa_workspaces")
    .select("id,owner_id,parent_workspace_id,tenant_level").eq("id",workspaceId).maybeSingle();
  if(!workspace||workspace.owner_id!==user.id)return json({error:"forbidden"},403);

  const action=String(b?.action||"status").trim();

  if(action==="status"){
    const {data:cfg}=await db.from("wa_voice_configs")
      .select("workspace_id,provider,enabled,reply_audio_when_customer_audio,auto_capture_owner_voice,clone_status,voice_id,voice_name,transcription_model,tts_model,credential_secret_id,last_sample_at,cloned_at,last_error,updated_at")
      .eq("workspace_id",workspaceId).maybeSingle();
    if(!cfg)return json({ok:true,config:null});
    const keyStatus=await providerKeyStatus(workspaceId);
    let cloneStatus=String(cfg.clone_status||"waiting_api_key");
    if(keyStatus.available&&!cfg.voice_id&&cloneStatus==="waiting_api_key"){
      cloneStatus="waiting_sample";
      await db.from("wa_voice_configs").update({
        clone_status:"waiting_sample",
        last_error:null,
        updated_at:new Date().toISOString()
      }).eq("workspace_id",workspaceId);
    }
    return json({ok:true,config:{
      workspace_id:cfg.workspace_id,
      provider:cfg.provider,
      enabled:cfg.enabled,
      reply_audio_when_customer_audio:cfg.reply_audio_when_customer_audio,
      auto_capture_owner_voice:cfg.auto_capture_owner_voice,
      clone_status:cloneStatus,
      voice_ready:!!cfg.voice_id,
      voice_name:cfg.voice_name,
      transcription_model:cfg.transcription_model,
      tts_model:cfg.tts_model,
      has_api_key:keyStatus.available,
      uses_shared_api_key:keyStatus.inherited,
      last_sample_at:cfg.last_sample_at,
      cloned_at:cfg.cloned_at,
      last_error:cfg.last_error,
      updated_at:cfg.updated_at
    }});
  }

  if(action==="save_key"){
    const apiKey=String(b?.api_key||"").trim();
    if(!apiKey)return json({error:"api_key_required"},400);
    const {error}=await db.rpc("voice_store_elevenlabs_api_key",{
      p_workspace_id:workspaceId,p_api_key:apiKey
    });
    if(error)return json({error:"save_key_failed"},500);
    const {data:cfg}=await db.from("wa_voice_configs")
      .select("clone_status,voice_id,updated_at").eq("workspace_id",workspaceId).single();
    return json({ok:true,clone_status:cfg.clone_status,voice_ready:!!cfg.voice_id,updated_at:cfg.updated_at});
  }

  if(action==="clear_key"){
    const {error}=await db.rpc("voice_clear_elevenlabs_api_key",{p_workspace_id:workspaceId});
    return error?json({error:"clear_key_failed"},500):json({ok:true});
  }

  if(action==="capture_next_audio"){
    const {error}=await db.from("wa_voice_configs").update({
      voice_id:null,
      clone_status:"waiting_sample",
      last_error:null,
      updated_at:new Date().toISOString()
    }).eq("workspace_id",workspaceId);
    return error?json({error:error.message},500):json({ok:true,clone_status:"waiting_sample"});
  }

  if(action==="set_enabled"){
    const enabled=b?.enabled===true;
    const {error}=await db.from("wa_voice_configs").update({
      enabled,updated_at:new Date().toISOString()
    }).eq("workspace_id",workspaceId);
    return error?json({error:error.message},500):json({ok:true,enabled});
  }

  return json({error:"unknown_action"},400);
});