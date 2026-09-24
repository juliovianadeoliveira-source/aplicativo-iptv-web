
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
const clean=(v:string)=>v.trim().replace(/\/+$/,"");
const safe=(v:string)=>v.normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase().replace(/[^a-z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,60);
const randomToken=()=>crypto.randomUUID().replaceAll("-","")+crypto.randomUUID().replaceAll("-","");
async function sha256(v:string){
  const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function queueCommand(workspace_id:string,action:string,payload:any={},connection_slot=1){
  const slot=Math.max(1,Math.min(4,Number(connection_slot||1)));
  const {data:existing}=await db.from("wa_bridge_commands").select("id")
    .eq("workspace_id",workspace_id).eq("connection_slot",slot).eq("action",action).in("status",["queued","processing"])
    .order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(existing)return existing.id;
  const {data}=await db.from("wa_bridge_commands").insert({workspace_id,connection_slot:slot,action,payload}).select("id").single();
  return data?.id||null;
}

async function evo(c:any,path:string,init:RequestInit={}){
  const h=new Headers(init.headers||{});h.set("apikey",c.api_key);if(init.body)h.set("content-type","application/json");
  const r=await fetch(clean(c.base_url)+path,{...init,headers:h});
  const t=await r.text();let d:any={};try{d=t?JSON.parse(t):{}}catch{d={raw:t}}
  return {ok:r.ok,status:r.status,data:d};
}
function statusFrom(d:any){
  const st=d?.instance?.state??d?.state??d?.data?.state??d?.data?.status??d?.status??"";
  const connected=d?.data?.connected===true||d?.data?.loggedIn===true||d?.connected===true||d?.loggedIn===true||["open","connected","online"].includes(String(st).toLowerCase());
  return {connected,state:String(st||(connected?"connected":"disconnected"))};
}
function qrFrom(d:any){
  const xs=[d?.base64,d?.qrcode?.base64,d?.data?.base64,d?.data?.qrcode?.base64,d?.code,d?.qrcode?.code,d?.data?.code,d?.data?.qrcode?.code]
    .filter((x:any)=>typeof x==="string"&&x.length>40);
  let q=xs[0]||null;
  if(q&&!q.startsWith("data:image")&&/^[A-Za-z0-9+/=\r\n]+$/.test(q))q="data:image/png;base64,"+q.replace(/\s+/g,"");
  return q;
}
async function setWebhook(c:any){
  const u=URL+"/functions/v1/jstech-wa-evolution-webhook?token="+encodeURIComponent(c.webhook_secret);
  let r=await evo(c,"/webhook/set/"+encodeURIComponent(c.instance_name),{method:"POST",body:JSON.stringify({webhook:{enabled:true,url:u,webhookByEvents:false,webhookBase64:false,events:["MESSAGES_UPSERT","MESSAGES_UPDATE","CONNECTION_UPDATE"]}})});
  if(!r.ok)r=await evo(c,"/webhook/set/"+encodeURIComponent(c.instance_name),{method:"POST",body:JSON.stringify({enabled:true,url:u,webhook_by_events:false,webhook_base64:false,events:["MESSAGES_UPSERT","MESSAGES_UPDATE","CONNECTION_UPDATE"]})});
  return r;
}
async function ensureInstance(c:any){
  const n=encodeURIComponent(c.instance_name);
  const f=await evo(c,"/instance/fetchInstances?instanceName="+n);
  const rows=Array.isArray(f.data)?f.data:(Array.isArray(f.data?.data)?f.data.data:[]);
  if(f.ok&&rows.length)return;
  const cr=await evo(c,"/instance/create",{method:"POST",body:JSON.stringify({instanceName:c.instance_name,qrcode:true,integration:"WHATSAPP-BAILEYS"})});
  const dup=cr.status===409||/already|exists|existente|duplicate/i.test(JSON.stringify(cr.data||{}));
  if(!cr.ok&&!dup)throw new Error("Não foi possível criar a conexão no servidor do WhatsApp.");
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"method_not_allowed"},405);
  const jwt=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!jwt)return json({error:"unauthorized"},401);
  const {data:au,error:ae}=await db.auth.getUser(jwt);const user=au?.user;
  if(ae||!user)return json({error:"unauthorized"},401);
  let b:any={};try{b=await req.json()}catch{return json({error:"invalid_json"},400)}
  const wid=String(b?.workspace_id||""),action=String(b?.action||"status");
  if(!wid)return json({error:"workspace_id_required"},400);
  const {data:w}=await db.from("wa_workspaces").select("id,owner_id,slug").eq("id",wid).maybeSingle();
  if(!w||w.owner_id!==user.id)return json({error:"forbidden"},403);
  const {data:alias}=await db.from("wa_login_aliases").select("role").eq("auth_user_id",user.id).eq("workspace_id",wid).maybeSingle();
  const isReseller=alias?.role==="reseller";
  const slot=Math.max(1,Math.min(4,Number(b?.slot||1)));

  if(action==="list_connections"){
    const [{data:main},{data:extras},{data:settings}]=await Promise.all([
      db.from("wa_bridge_configs").select("workspace_id,provider,instance_name,last_status,agent_last_seen,external_user_id,provision_status,provision_error").eq("workspace_id",wid).maybeSingle(),
      db.from("wa_extra_bridge_configs").select("workspace_id,connection_slot,provider,instance_name,last_status,agent_last_seen,external_user_id,provision_status,provision_error").eq("workspace_id",wid).order("connection_slot"),
      db.from("wa_settings").select("bridge_connected,bridge_phone,bridge_name").eq("workspace_id",wid).maybeSingle()
    ]);
    const now=Date.now();
    const mainFresh=main?.agent_last_seen?now-Date.parse(main.agent_last_seen)<120000:true;
    const mainConnected=!!settings?.bridge_connected && (main?.provider!=="wuzapi-local" || mainFresh);
    const rows:any[]=[{
      slot:1,
      connected:mainConnected,
      configured:!!main || isReseller,
      state:mainConnected?"connected":String(main?.last_status||main?.provision_status||"disconnected"),
      provider:main?.provider||null,
      instance_name:main?.instance_name||null,
      phone:settings?.bridge_phone||null,
      name:settings?.bridge_name||null,
      error:main?.provision_error||null
    }];
    const map=new Map((extras||[]).map((x:any)=>[Number(x.connection_slot),x]));
    for(let s=2;s<=4;s++){
      const x:any=map.get(s);
      const fresh=x?.agent_last_seen?now-Date.parse(x.agent_last_seen)<120000:false;
      const connected=!!x && String(x.last_status||"").toLowerCase()==="connected" && fresh;
      rows.push({
        slot:s,connected,configured:!!x,
        state:connected?"connected":String(x?.last_status||x?.provision_status||"disconnected"),
        provider:x?.provider||"wuzapi-hosted",
        instance_name:x?.instance_name||null,
        phone:null,name:null,error:x?.provision_error||null
      });
    }
    return json({ok:true,connections:rows});
  }

  if(slot>1){
    let {data:extra}=await db.from("wa_extra_bridge_configs").select("*")
      .eq("workspace_id",wid).eq("connection_slot",slot).maybeSingle();

    if(!extra && action==="status"){
      return json({ok:true,slot,configured:false,connected:false,hosted:true,managed_locally:true,state:"disconnected"});
    }

    if(!extra && action==="connect"){
      const userToken=randomToken();
      const sig=await sha256(userToken);
      const instance=safe("wa-"+String(w.slug||wid.slice(0,8))+"-"+slot);
      const {data:newCfg,error:saveErr}=await db.from("wa_extra_bridge_configs").insert({
        workspace_id:wid,connection_slot:slot,provider:"wuzapi-hosted",base_url:"http://127.0.0.1:8080",
        api_key:userToken,instance_name:instance,webhook_secret:randomToken(),
        agent_token_hash:sig,agent_version:"hosted-1",provision_status:"queued",
        last_status:"provisioning",updated_at:new Date().toISOString()
      }).select("*").single();
      if(saveErr)return json({error:"bridge_prepare_failed",detail:saveErr.message},500);
      extra=newCfg;
      await queueCommand(wid,"provision",{},slot);
      return json({ok:true,slot,configured:true,connected:false,hosted:true,managed_locally:true,provisioning:true,state:"preparing_qr"});
    }

    if(!extra)return json({ok:true,slot,configured:false,connected:false,state:"disconnected"});

    const fresh=extra.agent_last_seen ? Date.now()-Date.parse(extra.agent_last_seen)<120000 : false;
    const connected=String(extra.last_status||"").toLowerCase()==="connected" && fresh;
    const qrValid=!!extra.qr_code && (!extra.qr_expires_at || Date.parse(extra.qr_expires_at)>Date.now());

    if(action==="status"){
      if(!connected && ["ready","waiting_qr","connected"].includes(String(extra.provision_status||""))){
        await queueCommand(wid,"status",{},slot);
      }
      return json({
        ok:true,slot,configured:true,connected,hosted:true,managed_locally:true,
        provider:"wuzapi-hosted",instance_name:extra.instance_name,
        state:connected?"connected":String(extra.last_status||extra.provision_status||"offline"),
        provisioning:["queued","processing"].includes(String(extra.provision_status||"")),
        qr:connected?null:(qrValid?extra.qr_code:null),
        error:extra.provision_error||null
      });
    }

    if(action==="connect"){
      if(connected)return json({ok:true,slot,configured:true,connected:true,hosted:true,managed_locally:true,state:"connected"});
      await db.from("wa_extra_bridge_configs").update({
        provision_status:"queued",provision_error:null,updated_at:new Date().toISOString()
      }).eq("workspace_id",wid).eq("connection_slot",slot);
      await queueCommand(wid,extra.provision_status?"connect":"provision",{},slot);
      return json({ok:true,slot,configured:true,connected:false,hosted:true,managed_locally:true,provisioning:true,qr:qrValid?extra.qr_code:null,state:"preparing_qr"});
    }

    if(action==="disconnect"){
      await queueCommand(wid,"logout",{},slot);
      await db.from("wa_extra_bridge_configs").update({
        qr_code:null,qr_expires_at:null,last_status:"disconnecting",updated_at:new Date().toISOString()
      }).eq("workspace_id",wid).eq("connection_slot",slot);
      return json({ok:true,slot,connected:false,hosted:true,managed_locally:true,state:"disconnecting"});
    }

    if(action==="sync_contacts_status"){
      const {data:cmd}=await db.from("wa_bridge_commands")
        .select("id,status,result,error,created_at,completed_at")
        .eq("workspace_id",wid).eq("connection_slot",slot).eq("action","sync_contacts")
        .order("created_at",{ascending:false}).limit(1).maybeSingle();
      return json({ok:true,slot,status:cmd?.status||"none",result:cmd?.result||null,error:cmd?.error||null,completed_at:cmd?.completed_at||null});
    }

    if(action==="sync_contacts"){
      if(!connected)return json({error:"whatsapp_not_connected"},409);
      const commandId=await queueCommand(wid,"sync_contacts",{},slot);
      return json({ok:true,slot,queued:true,command_id:commandId});
    }

    return json({error:"unknown_action"},400);
  }

  if(action==="configure"){
    if(isReseller)return json({error:"forbidden",message:"Revenda usa somente a conexão própria por QR Code."},403);
    const base=clean(String(b?.base_url||"")),key=String(b?.api_key||"").trim(),name=safe(String(b?.instance_name||w.slug||"jstech"));
    if(!/^https?:\/\//i.test(base))return json({error:"invalid_base_url"},400);
    if(key.length<12)return json({error:"invalid_api_key"},400);
    const {data:cur}=await db.from("wa_bridge_configs").select("webhook_secret").eq("workspace_id",wid).maybeSingle();
    const {error}=await db.from("wa_bridge_configs").upsert({
      workspace_id:wid,provider:"evolution",base_url:base,api_key:key,instance_name:name,
      webhook_secret:cur?.webhook_secret||randomToken(),agent_token_hash:null,updated_at:new Date().toISOString()
    },{onConflict:"workspace_id"});
    if(error)return json({error:"save_failed"},500);
    await db.from("wa_settings").update({connection_mode:"qr",bridge_connected:false,updated_at:new Date().toISOString()}).eq("workspace_id",wid);
    return json({ok:true,configured:true,base_url:base,instance_name:name});
  }

  let {data:c}=await db.from("wa_bridge_configs").select("*").eq("workspace_id",wid).maybeSingle();

  if(!c && isReseller){
    if(action==="status"){
      return json({ok:true,configured:true,setup_required:false,connected:false,hosted:true,provider:"wuzapi-hosted",managed_locally:true});
    }
    if(action==="connect"){
      const userToken=randomToken();
      const sig=await sha256(userToken);
      const instance=safe("rev-"+String(w.slug||wid.slice(0,8)));
      const {data:newCfg,error:saveErr}=await db.from("wa_bridge_configs").insert({
        workspace_id:wid,provider:"wuzapi-hosted",base_url:"http://127.0.0.1:8080",
        api_key:userToken,instance_name:instance,webhook_secret:randomToken(),
        agent_token_hash:sig,agent_version:"hosted-1",provision_status:"queued",
        last_status:"provisioning",updated_at:new Date().toISOString()
      }).select("*").single();
      if(saveErr)return json({error:"bridge_prepare_failed"},500);
      c=newCfg;
      await db.from("wa_settings").update({connection_mode:"qr",bridge_connected:false,updated_at:new Date().toISOString()}).eq("workspace_id",wid);
      await queueCommand(wid,"provision",{},1);
      return json({ok:true,configured:true,connected:false,hosted:true,managed_locally:true,provisioning:true,state:"preparing_qr"});
    }
  }

  if(!c)return json({ok:true,configured:false,setup_required:true,connected:false,message:"Servidor do WhatsApp ainda não configurado."});

  if(action==="sync_contacts_status"){
    const {data:cmd}=await db.from("wa_bridge_commands")
      .select("id,status,result,error,created_at,completed_at")
      .eq("workspace_id",wid).eq("action","sync_contacts")
      .order("created_at",{ascending:false}).limit(1).maybeSingle();
    return json({ok:true,status:cmd?.status||"none",result:cmd?.result||null,error:cmd?.error||null,completed_at:cmd?.completed_at||null});
  }

  if(action==="sync_contacts"){
    if(!["wuzapi-local","wuzapi-hosted"].includes(String(c.provider||""))){
      return json({error:"contact_sync_not_supported"},400);
    }
    const {data:s}=await db.from("wa_settings").select("bridge_connected").eq("workspace_id",wid).maybeSingle();
    if(!s?.bridge_connected)return json({error:"whatsapp_not_connected"},409);
    const commandId=await queueCommand(wid,"sync_contacts",{},1);
    return json({ok:true,queued:true,command_id:commandId});
  }

  if(c.provider==="wuzapi-hosted"){
    const connected=!!(await db.from("wa_settings").select("bridge_connected").eq("workspace_id",wid).maybeSingle()).data?.bridge_connected;
    const qrValid=!!c.qr_code && (!c.qr_expires_at || Date.parse(c.qr_expires_at)>Date.now());
    if(action==="status"){
      if(!connected && ["ready","waiting_qr"].includes(String(c.provision_status||""))){
        await queueCommand(wid,"status",{},1);
      }
      return json({
        ok:true,configured:true,connected,hosted:true,managed_locally:true,
        provider:"wuzapi-hosted",instance_name:c.instance_name,
        state:connected?"connected":String(c.last_status||c.provision_status||"offline"),
        provisioning:["queued","processing"].includes(String(c.provision_status||"")),
        qr:connected?null:(qrValid?c.qr_code:null),
        error:c.provision_error||null
      });
    }
    if(action==="connect"){
      if(connected)return json({ok:true,configured:true,connected:true,hosted:true,managed_locally:true,state:"connected"});
      await db.from("wa_bridge_configs").update({provision_status:"queued",provision_error:null,updated_at:new Date().toISOString()}).eq("workspace_id",wid);
      await queueCommand(wid,c.provision_status?"connect":"provision",{});
      return json({ok:true,configured:true,connected:false,hosted:true,managed_locally:true,provisioning:true,qr:qrValid?c.qr_code:null,state:"preparing_qr"});
    }
    if(action==="disconnect"){
      await queueCommand(wid,"logout",{},1);
      await db.from("wa_settings").update({bridge_connected:false,bridge_phone:null,bridge_name:null,updated_at:new Date().toISOString()}).eq("workspace_id",wid);
      await db.from("wa_bridge_configs").update({qr_code:null,qr_expires_at:null,last_status:"disconnecting",updated_at:new Date().toISOString()}).eq("workspace_id",wid);
      return json({ok:true,connected:false,hosted:true,managed_locally:true,state:"disconnecting"});
    }
    return json({error:"unknown_action"},400);
  }

  if(c.provider==="wuzapi-local"){
    const {data:s}=await db.from("wa_settings").select("bridge_connected,bridge_phone,bridge_name").eq("workspace_id",wid).maybeSingle();
    const seen=c.agent_last_seen?Date.parse(c.agent_last_seen):0;
    const fresh=seen>0&&(Date.now()-seen)<120000;
    const connected=!!s?.bridge_connected&&fresh;
    const qrValid=!!c.qr_code&&(!c.qr_expires_at||Date.parse(c.qr_expires_at)>Date.now());

    if(!fresh&&s?.bridge_connected){
      await db.from("wa_settings").update({bridge_connected:false,updated_at:new Date().toISOString()}).eq("workspace_id",wid);
    }

    if(action==="status"){
      if(fresh&&!connected&&!qrValid)await queueCommand(wid,"status",{},1);
      return json({
        ok:true,configured:true,setup_required:false,connected,
        state:connected?"connected":(fresh?String(c.last_status||"waiting_qr"):"offline"),
        provider:"wuzapi-local",instance_name:c.instance_name,managed_locally:true,
        qr:connected?null:(qrValid?c.qr_code:null)
      });
    }

    if(action==="connect"){
      if(!fresh){
        return json({
          ok:true,configured:true,connected:false,state:"offline",
          provider:"wuzapi-local",instance_name:c.instance_name,managed_locally:true,
          qr:qrValid?c.qr_code:null,
          message:"Agente JSTech ainda não respondeu."
        });
      }
      if(connected){
        return json({ok:true,configured:true,connected:true,state:"connected",provider:"wuzapi-local",instance_name:c.instance_name,managed_locally:true});
      }
      await queueCommand(wid,"connect",{},1);
      return json({
        ok:true,configured:true,connected:false,state:"preparing_qr",
        provider:"wuzapi-local",instance_name:c.instance_name,managed_locally:true,
        qr:qrValid?c.qr_code:null
      });
    }

    if(action==="disconnect"){
      if(fresh)await queueCommand(wid,"logout",{},1);
      await db.from("wa_settings").update({bridge_connected:false,bridge_phone:null,bridge_name:null,updated_at:new Date().toISOString()}).eq("workspace_id",wid);
      await db.from("wa_bridge_configs").update({qr_code:null,qr_expires_at:null,last_status:"disconnecting",updated_at:new Date().toISOString()}).eq("workspace_id",wid);
      return json({ok:true,connected:false,state:"disconnecting",provider:"wuzapi-local",managed_locally:true});
    }
    return json({error:"unknown_action"},400);
  }

  try{
    if(action==="status"){
      const r=await evo(c,"/instance/connectionState/"+encodeURIComponent(c.instance_name));
      const st=r.ok?statusFrom(r.data):{connected:false,state:"offline"};
      await db.from("wa_settings").update({connection_mode:"qr",bridge_connected:st.connected,updated_at:new Date().toISOString()}).eq("workspace_id",wid);
      return json({ok:true,configured:true,...st,instance_name:c.instance_name,base_url:c.base_url});
    }
    if(action==="connect"){
      await ensureInstance(c);await setWebhook(c);
      const r=await evo(c,"/instance/connect/"+encodeURIComponent(c.instance_name));
      if(!r.ok)return json({error:"connect_failed",detail:r.data},502);
      const st=statusFrom(r.data),qr=qrFrom(r.data);
      if(st.connected)await db.from("wa_settings").update({connection_mode:"qr",bridge_connected:true,updated_at:new Date().toISOString()}).eq("workspace_id",wid);
      return json({ok:true,configured:true,connected:st.connected,state:st.state,qr,pairing_code:r.data?.pairingCode??r.data?.data?.pairingCode??null,instance_name:c.instance_name});
    }
    if(action==="disconnect"){
      const r=await evo(c,"/instance/logout/"+encodeURIComponent(c.instance_name),{method:"DELETE"});
      await db.from("wa_settings").update({bridge_connected:false,bridge_phone:null,bridge_name:null,updated_at:new Date().toISOString()}).eq("workspace_id",wid);
      return json({ok:r.ok,connected:false});
    }
    return json({error:"unknown_action"},400);
  }catch(e:any){return json({error:"bridge_unavailable",message:String(e?.message||e)},502)}
});
