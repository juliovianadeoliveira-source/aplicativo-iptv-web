
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const URL=Deno.env.get("SUPABASE_URL")!;
const legacy=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const sj=Deno.env.get("SUPABASE_SECRET_KEYS");
const SERVICE=sj?JSON.parse(sj)["default"]:legacy;
if(!SERVICE)throw new Error("backend key unavailable");
const db=createClient(URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
const json=(d:any,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{
  "content-type":"application/json; charset=utf-8",
  "access-control-allow-origin":"*",
  "access-control-allow-headers":"authorization, apikey, content-type",
  "access-control-allow-methods":"POST, OPTIONS"
}});

async function auth(req:Request){
  const a=req.headers.get("authorization")||"";
  const token=a.startsWith("Bearer ")?a.slice(7):"";
  if(!token)return null;
  const {data,error}=await db.auth.getUser(token);
  if(error||!data.user)return null;
  return data.user;
}
async function owns(uid:string,wid:string){
  const {data}=await db.from("wa_workspaces").select("id").eq("id",wid).eq("owner_id",uid).maybeSingle();
  return !!data;
}
function safeUrl(v:any){
  const s=String(v||"").trim();
  if(!s)return null;
  try{
    const u=new URL(s);
    if(!["http:","https:"].includes(u.protocol))return null;
    return u.toString();
  }catch{return null}
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:{
    "access-control-allow-origin":"*",
    "access-control-allow-headers":"authorization, apikey, content-type",
    "access-control-allow-methods":"POST, OPTIONS"
  }});
  if(req.method!=="POST")return json({error:"method_not_allowed"},405);

  const user=await auth(req);
  if(!user)return json({error:"unauthorized"},401);
  let b:any={};try{b=await req.json()}catch{}
  const action=String(b?.action||"list");
  const wid=String(b?.workspace_id||"");
  if(!wid||!(await owns(user.id,wid)))return json({error:"forbidden"},403);

  if(action==="list"){
    const [panelsRes,appsRes,mapRes,jobsRes]=await Promise.all([
      db.from("wa_panel_connectors")
        .select("id,name,provider_type,driver_type,base_url,login_path,capabilities,app_names,enabled,last_status,last_checked_at,credential_secret_id,catalog_key,consecutive_failures,last_success_at,last_error,health_checked_at")
        .eq("workspace_id",wid).order("name"),
      db.from("wa_app_catalog")
        .select("id,name,platforms,enabled,requires_mac_key,activation_driver,activation_url,activation_method,activation_secret_id,activation_payload_template,activation_notes,activation_api_key_header,activation_api_key_prefix")
        .eq("workspace_id",wid).eq("enabled",true).order("name"),
      db.from("wa_panel_app_map")
        .select("id,connector_id,app_catalog_id,app_name,panel_app_code,priority,enabled,notes")
        .eq("workspace_id",wid).eq("enabled",true).order("priority"),
      db.from("wa_panel_jobs")
        .select("id,connector_id,contact_id,conversation_id,action_type,app_name,plan_days,customer_name,customer_phone,status,error,result,created_at,started_at,completed_at,requested_username,screen_count,payload")
        .eq("workspace_id",wid).order("created_at",{ascending:false}).limit(100)
    ]);
    if(panelsRes.error)return json({error:panelsRes.error.message},400);
    if(appsRes.error)return json({error:appsRes.error.message},400);
    if(mapRes.error)return json({error:mapRes.error.message},400);
    if(jobsRes.error)return json({error:jobsRes.error.message},400);
    return json({
      ok:true,
      panels:(panelsRes.data||[]).map((x:any)=>({
        id:x.id,name:x.name,provider_type:x.provider_type,driver_type:x.driver_type,
        base_url:x.base_url,login_path:x.login_path,capabilities:x.capabilities||[],
        app_names:x.app_names||[],enabled:!!x.enabled,last_status:x.last_status||"aguardando_credenciais",
        last_checked_at:x.last_checked_at,has_credentials:!!x.credential_secret_id,catalog_key:x.catalog_key,consecutive_failures:Number(x.consecutive_failures||0),last_success_at:x.last_success_at,last_error:x.last_error||null,health_checked_at:x.health_checked_at
      })),
      apps:(appsRes.data||[]).map((x:any)=>({
        id:x.id,name:x.name,platforms:x.platforms||[],enabled:!!x.enabled,
        requires_mac_key:!!x.requires_mac_key,
        activation_driver:x.activation_driver||null,
        activation_url:x.activation_url||null,
        activation_method:x.activation_method||"POST",
        activation_payload_template:x.activation_payload_template||{mac:"{{mac}}",key:"{{key}}"},
        activation_notes:x.activation_notes||null,
        activation_api_key_header:x.activation_api_key_header||"Authorization",
        activation_api_key_prefix:x.activation_api_key_prefix??"Bearer ",
        has_activation_credentials:!!x.activation_secret_id
      })),
      mappings:mapRes.data||[],
      jobs:jobsRes.data||[]
    });
  }

  if(action==="save_app_activation"){
    const appId=String(b?.app_catalog_id||"");
    const {data:app}=await db.from("wa_app_catalog")
      .select("id,name").eq("id",appId).eq("workspace_id",wid).eq("enabled",true).maybeSingle();
    if(!app)return json({error:"app_not_found"},404);

    const requires=b?.requires_mac_key===true;
    const driver=requires?String(b?.activation_driver||"").trim().toLowerCase():null;
    if(requires&&!["api","rpa"].includes(driver))return json({error:"activation_driver_required"},400);

    const rawUrl=String(b?.activation_url||"").trim();
    const activationUrl=rawUrl?safeUrl(rawUrl):null;
    if(requires&&rawUrl&&!activationUrl)return json({error:"invalid_activation_url"},400);
    if(requires&&!activationUrl)return json({error:"activation_url_required"},400);

    const method=String(b?.activation_method||"POST").trim().toUpperCase();
    if(!["GET","POST","PUT","PATCH"].includes(method))return json({error:"invalid_activation_method"},400);

    const template=(b?.activation_payload_template&&typeof b.activation_payload_template==="object")
      ? b.activation_payload_template
      : {mac:"{{mac}}",key:"{{key}}"};

    const {error:updateErr}=await db.from("wa_app_catalog").update({
      requires_mac_key:requires,
      activation_driver:driver,
      activation_url:activationUrl,
      activation_method:method,
      activation_payload_template:template,
      activation_notes:String(b?.activation_notes||"").trim()||null,
      activation_api_key_header:String(b?.activation_api_key_header||"Authorization").trim()||"Authorization",
      activation_api_key_prefix:String(b?.activation_api_key_prefix??"Bearer "),
      updated_at:new Date().toISOString()
    }).eq("id",app.id).eq("workspace_id",wid);
    if(updateErr)return json({error:updateErr.message},400);

    const username=String(b?.activation_username||"").trim();
    const password=String(b?.activation_password||"");
    const apiKey=String(b?.activation_api_key||"").trim();
    if(username||password||apiKey){
      const {error:secretErr}=await db.rpc("app_store_activation_credentials",{
        p_app_id:app.id,p_username:username||null,p_password:password||null,p_api_key:apiKey||null
      });
      if(secretErr)return json({error:"activation_credential_store_failed"},500);
    }

    const {data:saved}=await db.from("wa_app_catalog")
      .select("id,name,requires_mac_key,activation_driver,activation_url,activation_method,activation_secret_id,activation_payload_template,activation_notes,activation_api_key_header,activation_api_key_prefix")
      .eq("id",app.id).eq("workspace_id",wid).single();

    return json({ok:true,app:{
      id:saved.id,name:saved.name,requires_mac_key:!!saved.requires_mac_key,
      activation_driver:saved.activation_driver||null,
      activation_url:saved.activation_url||null,
      activation_method:saved.activation_method||"POST",
      activation_payload_template:saved.activation_payload_template||{mac:"{{mac}}",key:"{{key}}"},
      activation_notes:saved.activation_notes||null,
      activation_api_key_header:saved.activation_api_key_header||"Authorization",
      activation_api_key_prefix:saved.activation_api_key_prefix??"Bearer ",
      has_activation_credentials:!!saved.activation_secret_id
    }});
  }

  if(action==="clear_app_activation_credentials"){
    const appId=String(b?.app_catalog_id||"");
    const {data:app}=await db.from("wa_app_catalog").select("id").eq("id",appId).eq("workspace_id",wid).maybeSingle();
    if(!app)return json({error:"app_not_found"},404);
    const {error}=await db.rpc("app_clear_activation_credentials",{p_app_id:app.id});
    return error?json({error:"activation_credential_clear_failed"},500):json({ok:true});
  }

  const id=String(b?.connector_id||"");
  const {data:panel}=await db.from("wa_panel_connectors")
    .select("id,workspace_id,name,base_url,credential_secret_id,enabled,last_status,capabilities")
    .eq("id",id).eq("workspace_id",wid).maybeSingle();
  if(!panel)return json({error:"panel_not_found"},404);

  if(action==="queue_job"){
    const actionType=String(b?.action_type||"").trim();
    const allowed=["test","create_user","search_user","renew","activate","activate_app","refresh_access","check_codes"];
    if(!allowed.includes(actionType))return json({error:"unsupported_job_action"},400);

    const caps=Array.isArray(panel.capabilities)?panel.capabilities.map((x:any)=>String(x)):[];
    const capAlias:any={
      test:"test",
      create_user:"create_user",
      search_user:"lookup_client",
      refresh_access:"lookup_client",
      check_codes:"lookup_client",
      renew:"renew",
      activate:"renew",
      activate_app:"activate_app"
    };
    const needed=capAlias[actionType];
    if(needed&&caps.length&&!caps.includes(needed)&&!(needed==="lookup_client"&&caps.includes("search_user"))){
      return json({error:"panel_capability_not_enabled"},400);
    }

    const payload=(b?.payload&&typeof b.payload==="object")?b.payload:{};
    const username=String(b?.username||payload?.username||"").trim();
    const appCatalogId=String(b?.app_catalog_id||"").trim()||null;
    const appName=String(b?.app_name||"").trim()||null;
    const panelAppCode=String(b?.panel_app_code||"").trim()||null;
    const screenCount=Math.max(1,Math.min(10,Number(b?.screen_count||payload?.screen_count||1)));
    const planDays=[30,90,180,365].includes(Number(b?.plan_days||payload?.plan_days))
      ? Number(b?.plan_days||payload?.plan_days)
      : null;

    if(["search_user","refresh_access","check_codes","renew","activate"].includes(actionType)&&!username){
      return json({error:"username_required"},400);
    }

    const ready=!!(panel.enabled&&panel.credential_secret_id&&panel.last_status==="driver_ready");
    const status=ready?"pending":"waiting_setup";
    const row:any={
      workspace_id:wid,
      connector_id:panel.id,
      action_type:actionType,
      status,
      contact_id:b?.contact_id||null,
      conversation_id:b?.conversation_id||null,
      app_catalog_id:appCatalogId,
      app_name:appName,
      panel_app_code:panelAppCode,
      screen_count:screenCount,
      plan_days:planDays,
      customer_name:String(b?.customer_name||payload?.customer_name||"").trim()||null,
      customer_phone:String(b?.customer_phone||payload?.phone||"").trim()||null,
      requested_username:username||null,
      payload:{
        ...payload,
        ...(username?{username}:{}),
        ...(planDays?{plan_days:planDays}:{}),
        screen_count:screenCount,
        source:"panel_automation_center"
      }
    };
    const ins=await db.from("wa_panel_jobs").insert(row).select("*").single();
    if(ins.error)return json({error:ins.error.message},400);
    return json({ok:true,job:ins.data,queued:ready,waiting_setup:!ready});
  }

  if(action==="save_app_mapping"){
    const appId=String(b?.app_catalog_id||"");
    const {data:app}=await db.from("wa_app_catalog")
      .select("id,name").eq("id",appId).eq("workspace_id",wid).eq("enabled",true).maybeSingle();
    if(!app)return json({error:"app_not_found"},404);
    const code=String(b?.panel_app_code||"").trim()||null;
    const priority=Math.max(1,Math.min(999,Number(b?.priority||100)));
    const {error}=await db.from("wa_panel_app_map").upsert({
      workspace_id:wid,connector_id:id,app_catalog_id:app.id,app_name:app.name,
      panel_app_code:code,priority,enabled:true,notes:String(b?.notes||"").trim()||null,
      updated_at:new Date().toISOString()
    },{onConflict:"connector_id,app_catalog_id"});
    if(error)return json({error:error.message},400);

    const {data:names}=await db.from("wa_panel_app_map")
      .select("app_name").eq("connector_id",id).eq("enabled",true).order("priority");
    await db.from("wa_panel_connectors").update({
      app_names:(names||[]).map((x:any)=>x.app_name),
      updated_at:new Date().toISOString()
    }).eq("id",id).eq("workspace_id",wid);
    return json({ok:true});
  }

  if(action==="delete_app_mapping"){
    const mappingId=String(b?.mapping_id||"");
    const {error}=await db.from("wa_panel_app_map")
      .delete().eq("id",mappingId).eq("connector_id",id).eq("workspace_id",wid);
    if(error)return json({error:error.message},400);
    const {data:names}=await db.from("wa_panel_app_map")
      .select("app_name").eq("connector_id",id).eq("enabled",true).order("priority");
    await db.from("wa_panel_connectors").update({
      app_names:(names||[]).map((x:any)=>x.app_name),
      updated_at:new Date().toISOString()
    }).eq("id",id).eq("workspace_id",wid);
    return json({ok:true});
  }

  if(action==="save_credentials"){
    const username=String(b?.username||"").trim();
    const password=String(b?.password||"");
    if(!username||!password)return json({error:"username_password_required"},400);
    const {error:rpcError}=await db.rpc("panel_store_credentials",{
      p_connector_id:id,p_username:username,p_password:password
    });
    if(rpcError)return json({error:"credential_store_failed"},500);
    const patch:any={
      enabled:true,last_status:"validando_login",updated_at:new Date().toISOString()
    };
    const base=safeUrl(b?.base_url);
    if(base)patch.base_url=base;
    if(b?.login_path!==undefined)patch.login_path=String(b.login_path||"").trim()||null;
    const {error}=await db.from("wa_panel_connectors").update(patch).eq("id",id).eq("workspace_id",wid);
    if(error)return json({error:error.message},400);

    await db.from("wa_panel_jobs").update({
      status:"cancelled",error:"new_credentials_saved",completed_at:new Date().toISOString()
    }).eq("workspace_id",wid).eq("connector_id",id).eq("action_type","probe_login").in("status",["pending","processing","waiting_setup"]);

    await db.from("wa_panel_jobs").insert({
      workspace_id:wid,connector_id:id,action_type:"probe_login",status:"pending",
      payload:{source:"admin_credentials_save"}
    });

    return json({ok:true,saved:true,validation_queued:true});
  }

  if(action==="clear_credentials"){
    const {error}=await db.rpc("panel_clear_credentials",{p_connector_id:id});
    if(error)return json({error:"credential_clear_failed"},500);
    await db.from("wa_panel_connectors").update({
      enabled:false,last_status:"aguardando_credenciais",updated_at:new Date().toISOString()
    }).eq("id",id).eq("workspace_id",wid);
    return json({ok:true,cleared:true});
  }

  if(action==="update_panel"){
    const patch:any={updated_at:new Date().toISOString()};
    if(b?.base_url!==undefined){
      const u=safeUrl(b.base_url);
      if(b.base_url && !u)return json({error:"invalid_url"},400);
      patch.base_url=u;
    }
    if(b?.login_path!==undefined)patch.login_path=String(b.login_path||"").trim()||null;
    if(Array.isArray(b?.app_names))patch.app_names=b.app_names.map((x:any)=>String(x).trim()).filter(Boolean).slice(0,50);
    if(typeof b?.enabled==="boolean")patch.enabled=b.enabled;
    const {error}=await db.from("wa_panel_connectors").update(patch).eq("id",id).eq("workspace_id",wid);
    if(error)return json({error:error.message},400);
    return json({ok:true});
  }

  if(action==="test_site"){
    const target=safeUrl(b?.base_url||panel.base_url);
    if(!target)return json({error:"panel_url_missing"},400);
    let ok=false,status=0,detail="";
    try{
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),10000);
      const res=await fetch(target,{method:"GET",redirect:"follow",signal:controller.signal,headers:{"user-agent":"JSTechPanelConnector/1.0"}});
      clearTimeout(timer);
      status=res.status;ok=res.status>=200&&res.status<500;
      detail=ok?"site_reachable":"http_"+res.status;
    }catch(e:any){detail=String(e?.name==="AbortError"?"timeout":e?.message||"connection_failed").slice(0,160)}
    await db.from("wa_panel_connectors").update({
      last_status:ok?"site_online":"site_inacessivel",
      last_checked_at:new Date().toISOString(),
      updated_at:new Date().toISOString()
    }).eq("id",id).eq("workspace_id",wid);
    return json({ok,status,detail});
  }

  return json({error:"unknown_action"},400);
});
