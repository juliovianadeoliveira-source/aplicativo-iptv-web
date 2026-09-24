
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const url=Deno.env.get("SUPABASE_URL")!;
const legacy=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const sj=Deno.env.get("SUPABASE_SECRET_KEYS");
const service=sj?JSON.parse(sj)["default"]:legacy;
if(!service)throw new Error("backend key unavailable");
const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
const json=(d:any,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{
  "content-type":"application/json; charset=utf-8",
  "access-control-allow-origin":"*",
  "access-control-allow-headers":"authorization, content-type, apikey"
}});
async function uid(req:Request){
  const h=req.headers.get("authorization")||"",t=h.startsWith("Bearer ")?h.slice(7):"";
  if(!t)return null;
  const {data,error}=await db.auth.getUser(t);
  return error?null:data.user?.id||null;
}
async function owns(userId:string,wid:string){
  const {data}=await db.from("wa_workspaces").select("id").eq("id",wid).eq("owner_id",userId).maybeSingle();
  return !!data;
}
function norm(v:any){return String(v||"").trim().toLowerCase().replace(/[^a-z0-9._-]/g,"")}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:{
    "access-control-allow-origin":"*",
    "access-control-allow-headers":"authorization, content-type, apikey",
    "access-control-allow-methods":"POST, OPTIONS"
  }});
  if(req.method!=="POST")return json({error:"method_not_allowed"},405);
  const userId=await uid(req);if(!userId)return json({error:"unauthorized"},401);
  let b:any;try{b=await req.json()}catch{return json({error:"invalid_json"},400)}
  const action=String(b?.action||"list"),wid=String(b?.workspace_id||"");
  if(!wid||!(await owns(userId,wid)))return json({error:"forbidden"},403);

  if(action==="list"){
    const {data,error}=await db.from("wa_reseller_tenants")
      .select("id,username,name,plan,active,created_at,reseller_workspace_id,auth_user_id")
      .eq("master_workspace_id",wid).order("created_at",{ascending:false});
    return error?json({error:error.message},400):json({ok:true,resellers:data||[]});
  }

  if(action==="create"){
    const {data:parentWorkspace,error:parentErr}=await db.from("wa_workspaces")
      .select("id,tenant_level").eq("id",wid).maybeSingle();
    if(parentErr||!parentWorkspace)return json({error:"Conta principal não encontrada."},404);
    const parentLevel=Number(parentWorkspace.tenant_level||0);
    if(parentLevel>=2)return json({error:"Uma sub-revenda não pode criar outro nível de revenda."},403);
    const username=norm(b?.username),name=String(b?.name||"").trim(),password=String(b?.password||"");
    if(username.length<3)return json({error:"Usuário precisa ter pelo menos 3 caracteres."},400);
    if(name.length<2)return json({error:"Informe o nome da revenda."},400);
    if(password.length<8)return json({error:"Senha precisa ter pelo menos 8 caracteres."},400);

    const {data:exists}=await db.from("wa_login_aliases").select("id").ilike("username",username).maybeSingle();
    if(exists)return json({error:"Este usuário já existe."},409);

    const internal=username+"."+crypto.randomUUID().slice(0,8)+"@login.jstech.local";
    const {data:u,error:uerr}=await db.auth.admin.createUser({
      email:internal,password,email_confirm:true,
      user_metadata:{username,role:"reseller",display_name:name}
    });
    if(uerr||!u.user)return json({error:uerr?.message||"Falha ao criar usuário."},400);
    const au=u.user.id;

    try{
      const slug="rev-"+crypto.randomUUID().slice(0,8);
      const {data:w,error:werr}=await db.from("wa_workspaces")
        .insert({
          owner_id:au,name:name+" - Atendimento",slug,
          parent_workspace_id:wid,
          tenant_level:parentLevel+1,
          business_type:null,
          business_description:null,
          onboarding_completed:false
        }).select().single();
      if(werr)throw werr;

      const {data:tenantSchema,error:schemaErr}=await db.rpc("provision_wa_tenant_schema",{p_workspace_id:w.id,p_owner_id:au});
      if(schemaErr)throw schemaErr;
      const settings:any={
        workspace_id:w.id,
        company_name:name,
        virtual_agent_name:"",
        ai_enabled:true,
        ai_model:"gemini-3.6-flash",
        conversation_engine:"gemini",
        ai_instructions:"",
        welcome_message:"Olá! Como posso ajudar?",
        fallback_message:"Me explique um pouco mais para eu continuar do ponto certo.",
        connection_mode:"qr",
        bridge_connected:false,
        business_description:"",
        products_and_services:"",
        sales_objective:"Entender a necessidade, responder com clareza e preparar a próxima ação.",
        service_area:"",
        conversation_tone:"natural, educado, direto e sem repetir perguntas",
        qualification_questions:[],
        handoff_rules:[],
        bot_disclosure:false,
        universal_mode:true,
        humanized_mode:true,
        humanized_split_messages:true,
        humanized_emojis:true,
        humanized_abbreviations:true,
        web_research_enabled:true,
        media_understanding_enabled:true
      };
      const {error:settingsErr}=await db.from("wa_settings").insert(settings);
      if(settingsErr)throw settingsErr;

      const {error:voiceErr}=await db.from("wa_voice_configs").insert({
        workspace_id:w.id,
        provider:"elevenlabs",
        enabled:true,
        reply_audio_when_customer_audio:true,
        auto_capture_owner_voice:true,
        clone_status:"waiting_api_key",
        voice_name:name+" - Minha voz WhatsApp",
        transcription_model:"whisper-1",
        tts_model:"eleven_multilingual_v2"
      });
      if(voiceErr)throw voiceErr;

      await db.from("wa_login_aliases").insert({
        workspace_id:w.id,auth_user_id:au,username,auth_email:internal,role:"reseller",active:true
      });
      const {data:t,error:terr}=await db.from("wa_reseller_tenants").insert({
        master_workspace_id:wid,reseller_workspace_id:w.id,auth_user_id:au,
        username,name,plan:String(b?.plan||"revenda"),active:true
      }).select().single();
      if(terr)throw terr;
      return json({ok:true,reseller:t,tenant_schema:tenantSchema});
    }catch(e:any){
      await db.auth.admin.deleteUser(au).catch(()=>{});
      return json({error:e?.message||"Falha ao criar revenda."},400);
    }
  }

  const id=String(b?.reseller_id||"");
  const {data:r}=await db.from("wa_reseller_tenants").select("*").eq("id",id).eq("master_workspace_id",wid).maybeSingle();
  if(!r)return json({error:"Revenda não encontrada."},404);

  if(action==="disable"){
    await db.from("wa_reseller_tenants").update({active:false,updated_at:new Date().toISOString()}).eq("id",id);
    await db.from("wa_login_aliases").update({active:false,updated_at:new Date().toISOString()}).eq("auth_user_id",r.auth_user_id);
    await db.auth.admin.updateUserById(r.auth_user_id,{ban_duration:"876000h"});
    return json({ok:true});
  }
  if(action==="enable"){
    await db.from("wa_reseller_tenants").update({active:true,updated_at:new Date().toISOString()}).eq("id",id);
    await db.from("wa_login_aliases").update({active:true,updated_at:new Date().toISOString()}).eq("auth_user_id",r.auth_user_id);
    await db.auth.admin.updateUserById(r.auth_user_id,{ban_duration:"none"});
    return json({ok:true});
  }
  if(action==="password"){
    const password=String(b?.password||"");
    if(password.length<8)return json({error:"Senha precisa ter pelo menos 8 caracteres."},400);
    const {error}=await db.auth.admin.updateUserById(r.auth_user_id,{password});
    return error?json({error:error.message},400):json({ok:true});
  }
  return json({error:"unknown_action"},400);
});
