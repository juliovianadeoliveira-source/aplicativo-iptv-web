
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const URL=Deno.env.get("SUPABASE_URL")!;
const legacy=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const sj=Deno.env.get("SUPABASE_SECRET_KEYS");
const SERVICE=sj?JSON.parse(sj)["default"]:legacy;
if(!SERVICE)throw new Error("backend key unavailable");
const db=createClient(URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
const json=(d:any,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8"}});
const MASTER_WID="71634450-2a93-4796-a0fa-d3e2d534502f";

async function sha256(v:string){
  const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function cleanIso(v:any){
  const s=String(v||"").trim();
  if(!s)return null;
  const d=new Date(s);
  return Number.isNaN(d.getTime())?null:d.toISOString();
}
function accessDataFromResult(r:any){
  const out:any={};
  for(const k of ["username","password","url","server","dns","m3u","xtream_url","code","activation_code","device_key"]){
    const v=r?.[k]??r?.access_data?.[k];
    if(v!==undefined&&v!==null&&String(v).trim()!=="")out[k]=String(v).trim();
  }
  if(r?.codes&&typeof r.codes==="object")out.codes=r.codes;
  return out;
}
function accessMessage(r:any,job:any){
  const a=accessDataFromResult(r);
  const lines:string[]=[];
  if(job?.app_name)lines.push("Aplicativo: "+job.app_name);
  if(a.username)lines.push("Usuário: "+a.username);
  if(a.password)lines.push("Senha: "+a.password);
  if(a.url)lines.push("URL: "+a.url);
  if(a.server)lines.push("Servidor: "+a.server);
  if(a.dns)lines.push("DNS: "+a.dns);
  if(a.m3u)lines.push("M3U: "+a.m3u);
  if(a.xtream_url)lines.push("Xtream: "+a.xtream_url);
  if(a.code)lines.push("Código: "+a.code);
  if(a.activation_code)lines.push("Código de ativação: "+a.activation_code);
  if(a.device_key)lines.push("Chave: "+a.device_key);
  if(a.codes&&typeof a.codes==="object"){
    for(const [k,v] of Object.entries(a.codes)){
      if(v!==undefined&&v!==null&&String(v).trim())lines.push(String(k)+": "+String(v));
    }
  }
  const sc=Number(r?.screen_count||job?.screen_count||1);
  lines.push("Telas: "+sc);
  const exp=cleanIso(r?.expires_at);
  if(exp)lines.push("Vencimento: "+new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(exp)));
  return lines.join("\n");
}
async function importSyncedContacts(wid:string,result:any){
  const contacts=Array.isArray(result?.contacts)?result.contacts:[];
  const nowIso=new Date().toISOString();
  const rows:any[]=[];
  const seen=new Set<string>();
  for(const x of contacts){
    const phone=String(x?.phone||"").replace(/\D+/g,"");
    if(phone.length<10||phone.length>15||seen.has(phone))continue;
    seen.add(phone);
    const row:any={
      workspace_id:wid,
      phone,
      name:String(x?.name||"").trim()||phone,
      lead_source:"whatsapp_sync",
      lead_source_at:nowIso,
      updated_at:nowIso
    };
    const photo=String(x?.profile_photo_url||"").trim();
    const preview=String(x?.profile_photo_preview_url||"").trim();
    const hd=String(x?.profile_photo_hd_url||"").trim();

    if(preview){
      row.profile_photo_preview_url=preview;
      if(!hd)row.profile_photo_url=preview;
    }
    if(hd){
      row.profile_photo_hd_url=hd;
      row.profile_photo_url=hd;
    }else if(photo){
      if(/s96x96/i.test(photo)){
        row.profile_photo_preview_url=photo;
        row.profile_photo_url=photo;
      }else{
        row.profile_photo_hd_url=photo;
        row.profile_photo_url=photo;
      }
    }
    if(photo||preview||hd)row.profile_photo_updated_at=nowIso;
    rows.push(row);
  }
  for(let i=0;i<rows.length;i+=250){
    const part=rows.slice(i,i+250);
    const {error}=await db.from("wa_contacts").upsert(part,{onConflict:"workspace_id,phone",ignoreDuplicates:false});
    if(error)throw error;
  }
  const photoCount=rows.filter((x:any)=>!!(x.profile_photo_hd_url||x.profile_photo_preview_url||x.profile_photo_url)).length;
  await db.from("wa_settings").update({
    last_contact_sync_at:nowIso,
    last_contact_sync_count:rows.length,
    last_contact_photo_count:photoCount,
    updated_at:nowIso
  }).eq("workspace_id",wid);
  return rows.length;
}

async function queueCustomerMessage(job:any,text:string,meta:any={}){
  if(!job?.conversation_id||!job?.contact_id)return;
  const {data:cv}=await db.from("wa_conversations").select("connection_slot").eq("id",job.conversation_id).maybeSingle();
  const slot=Number(cv?.connection_slot||1);
  await db.from("wa_messages").insert({
    workspace_id:job.workspace_id,conversation_id:job.conversation_id,contact_id:job.contact_id,connection_slot:slot,
    direction:"out",sender_type:"bot",content:String(text||"").trim(),message_type:"text",status:"queued",
    metadata:{provider:"wuzapi-local",delay_ms:900,panel_job_id:job.id,connection_slot:slot,...meta}
  });
}

async function auth(req:Request){
  const raw=String(req.headers.get("token")||req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!raw)return null;
  const h=await sha256(raw);
  const {data}=await db.from("wa_bridge_configs")
    .select("workspace_id,provider")
    .eq("agent_token_hash",h).eq("provider","wuzapi-local").maybeSingle();
  return data||null;
}

Deno.serve(async req=>{
  if(req.method!=="POST")return json({error:"method_not_allowed"},405);
  const cfg=await auth(req);
  if(!cfg)return json({error:"unauthorized"},401);
  let b:any={};try{b=await req.json()}catch{}
  const action=String(b?.action||"pull"),wid=cfg.workspace_id;

  if(action.startsWith("host_") && wid!==MASTER_WID)return json({error:"forbidden"},403);

  if(action==="host_pull"){
    const nowIso=new Date().toISOString();
    await Promise.all([
      db.from("wa_bridge_configs").update({agent_last_seen:nowIso,agent_version:"hosted-1",updated_at:nowIso}).eq("provider","wuzapi-hosted"),
      db.from("wa_extra_bridge_configs").update({agent_last_seen:nowIso,agent_version:"hosted-1",updated_at:nowIso}).eq("provider","wuzapi-hosted")
    ]);

    const [{data:mainConfigs},{data:extraConfigs}]=await Promise.all([
      db.from("wa_bridge_configs")
        .select("workspace_id,api_key,instance_name,agent_token_hash,provision_status")
        .eq("provider","wuzapi-hosted"),
      db.from("wa_extra_bridge_configs")
        .select("workspace_id,connection_slot,api_key,instance_name,agent_token_hash,provision_status")
        .eq("provider","wuzapi-hosted")
    ]);
    const rows:any[]=[
      ...((mainConfigs||[]) as any[]).map((x:any)=>({...x,connection_slot:1})),
      ...((extraConfigs||[]) as any[])
    ];
    const keyOf=(wid:string,slot:any)=>String(wid)+":"+String(Number(slot||1));
    const map=new Map(rows.map((x:any)=>[keyOf(x.workspace_id,x.connection_slot),x]));
    const wids=[...new Set(rows.map((x:any)=>x.workspace_id))];

    const cutoff=new Date(Date.now()-120000).toISOString();
    const {data:stale}=await db.from("wa_messages")
      .select("id,workspace_id,connection_slot,metadata").eq("direction","out").eq("status","sending");
    for(const row of stale||[]){
      if(row?.metadata?.claimed_at && row.metadata.claimed_at<cutoff && map.has(keyOf(row.workspace_id,row.connection_slot))){
        await db.from("wa_messages").update({status:"queued",metadata:{...(row.metadata||{}),recovered_at:nowIso}}).eq("id",row.id);
      }
    }

    const messages:any[]=[];
    if(wids.length){
      const {data:queued}=await db.from("wa_messages")
        .select("id,workspace_id,connection_slot,content,sender_type,metadata,created_at,contact_id,wa_contacts!inner(phone)")
        .in("workspace_id",wids).eq("direction","out").eq("status","queued")
        .order("created_at",{ascending:true}).limit(40);
      for(const row of queued||[]){
        const cfg2:any=map.get(keyOf(row.workspace_id,row.connection_slot));
        if(!cfg2?.api_key)continue;
        const meta=row.metadata||{};
        const {data:claimed}=await db.from("wa_messages")
          .update({status:"sending",metadata:{...meta,claimed_at:new Date().toISOString()}})
          .eq("id",row.id).eq("status","queued").select("id").maybeSingle();
        if(!claimed)continue;
        messages.push({
          id:row.id,workspace_id:row.workspace_id,connection_slot:Number(row.connection_slot||1),wuz_token:cfg2.api_key,
          phone:row.wa_contacts?.phone||meta.to_phone||"",body:row.content,
          image_data_uri:meta.image_data_uri||null,
          audio_data_uri:meta.audio_data_uri||null,
          sender_type:row.sender_type,delay_ms:Number(meta.delay_ms||900)
        });
      }
    }

    let cmdRows:any[]=[];
    if(wids.length){
      const {data}=await db.from("wa_bridge_commands")
        .select("id,workspace_id,connection_slot,action,payload,created_at")
        .in("workspace_id",wids).eq("status","queued")
        .order("created_at",{ascending:true}).limit(20);
      cmdRows=data||[];
    }
    const commands:any[]=[];
    for(const row of cmdRows||[]){
      const cfg2:any=map.get(keyOf(row.workspace_id,row.connection_slot));
      if(!cfg2?.api_key)continue;
      const {data:claimed}=await db.from("wa_bridge_commands")
        .update({status:"processing",claimed_at:new Date().toISOString()})
        .eq("id",row.id).eq("status","queued").select("id").maybeSingle();
      if(!claimed)continue;
      commands.push({
        ...row,wuz_token:cfg2.api_key,instance_name:cfg2.instance_name,webhook_sig:cfg2.agent_token_hash
      });
    }
    return json({ok:true,messages,commands});
  }

  if(action==="host_ack_message"){
    const id=String(b?.message_id||""),workspaceId=String(b?.workspace_id||"");
    if(!id||!workspaceId)return json({error:"message_id_and_workspace_required"},400);
    const {data:row}=await db.from("wa_messages").select("metadata").eq("id",id).eq("workspace_id",workspaceId).maybeSingle();
    if(!row)return json({error:"not_found"},404);
    const ok=b?.ok===true,external=String(b?.external_message_id||"")||null;
    const meta={...(row.metadata||{}),completed_at:new Date().toISOString()};
    if(!ok)meta.error=String(b?.error||"send_failed").slice(0,500);
    const patch:any={status:ok?"sent":"failed",metadata:meta};
    if(ok&&external)patch.external_message_id=external;
    await db.from("wa_messages").update(patch).eq("id",id).eq("workspace_id",workspaceId);
    return json({ok:true});
  }

  if(action==="host_ack_command"){
    const id=String(b?.command_id||""),workspaceId=String(b?.workspace_id||"");
    if(!id||!workspaceId)return json({error:"command_id_and_workspace_required"},400);
    const ok=b?.ok===true;
    let result=(b?.result&&typeof b.result==="object")?b.result:{};
    const err=ok?null:String(b?.error||"command_failed").slice(0,1000);
    const {data:cmdRow}=await db.from("wa_bridge_commands")
      .select("action,connection_slot").eq("id",id).eq("workspace_id",workspaceId).maybeSingle();
    const slot=Number(cmdRow?.connection_slot||1);
    if(ok&&cmdRow?.action==="sync_contacts"){
      const received=Array.isArray(result?.contacts)?result.contacts.length:Number(result?.count||0);
      const imported=await importSyncedContacts(workspaceId,result);
      result={count:received,imported_count:imported};
    }
    await db.from("wa_bridge_commands").update({
      status:ok?"done":"failed",result,error:err,completed_at:new Date().toISOString()
    }).eq("id",id).eq("workspace_id",workspaceId);

    const cfgPatch:any={updated_at:new Date().toISOString(),agent_last_seen:new Date().toISOString()};
    if(result.qr_code!==undefined)cfgPatch.qr_code=result.qr_code||null;
    if(result.qr_expires_at!==undefined)cfgPatch.qr_expires_at=result.qr_expires_at||null;
    if(result.external_user_id)cfgPatch.external_user_id=String(result.external_user_id);
    if(ok){
      cfgPatch.provision_error=null;
      cfgPatch.provision_status=result.connected===true?"connected":(result.ready===true?"ready":"ready");
      cfgPatch.last_status=result.connected===true?"connected":String(result.status||"ready");
    }else{
      cfgPatch.provision_status="error";cfgPatch.provision_error=err;cfgPatch.last_status="error";
    }
    if(slot===1){
      await db.from("wa_bridge_configs").update(cfgPatch).eq("workspace_id",workspaceId);
      if(result.connected===true){
        await db.from("wa_settings").update({bridge_connected:true,updated_at:new Date().toISOString()}).eq("workspace_id",workspaceId);
      }else if(result.connected===false){
        await db.from("wa_settings").update({bridge_connected:false,updated_at:new Date().toISOString()}).eq("workspace_id",workspaceId);
      }
    }else{
      await db.from("wa_extra_bridge_configs").update(cfgPatch)
        .eq("workspace_id",workspaceId).eq("connection_slot",slot);
    }
    return json({ok:true});
  }

  if(action==="heartbeat"){
    const nowIso=new Date().toISOString();
    const connected=b?.connected===true;
    const cfgPatch:any={
      agent_last_seen:nowIso,
      last_status:String(b?.status||(connected?"connected":"waiting_qr")),
      updated_at:nowIso
    };
    if(b?.qr_code!==undefined)cfgPatch.qr_code=b.qr_code||null;
    if(b?.qr_expires_at!==undefined)cfgPatch.qr_expires_at=b.qr_expires_at||null;
    if(b?.external_user_id)cfgPatch.external_user_id=String(b.external_user_id);
    if(connected){cfgPatch.qr_code=null;cfgPatch.qr_expires_at=null}
    await db.from("wa_bridge_configs").update(cfgPatch).eq("workspace_id",wid);

    const settingsPatch:any={bridge_connected:connected,updated_at:nowIso};
    if(connected&&b?.jid)settingsPatch.bridge_phone=String(b.jid);
    if(connected&&b?.name)settingsPatch.bridge_name=String(b.name);
    await db.from("wa_settings").update(settingsPatch).eq("workspace_id",wid);
    return json({ok:true,connected});
  }

  await db.from("wa_bridge_configs").update({
    agent_last_seen:new Date().toISOString(),updated_at:new Date().toISOString()
  }).eq("workspace_id",wid);

  if(action==="pull"){
    const {data:rows,error}=await db.from("wa_messages")
      .select("id,content,sender_type,metadata,created_at,contact_id,wa_contacts!inner(phone)")
      .eq("workspace_id",wid).eq("direction","out").eq("status","queued")
      .order("created_at",{ascending:true}).limit(10);
    if(error)return json({error:"pull_failed"},500);
    const out:any[]=[];
    for(const row of rows||[]){
      const meta=row.metadata||{};
      const {data:claimed,error:claimErr}=await db.from("wa_messages")
        .update({status:"sending",metadata:{...meta,claimed_at:new Date().toISOString()}})
        .eq("id",row.id).eq("status","queued").select("id").maybeSingle();
      if(claimErr||!claimed)continue;
      out.push({
        id:row.id,
        phone:row.wa_contacts?.phone||meta.to_phone||"",
        body:row.content,
        image_data_uri:meta.image_data_uri||null,
          audio_data_uri:meta.audio_data_uri||null,
        sender_type:row.sender_type,
        delay_ms:Number(meta.delay_ms||1200)
      });
    }

    const {data:cmdRows}=await db.from("wa_bridge_commands")
      .select("id,workspace_id,action,payload,created_at")
      .eq("workspace_id",wid).eq("status","queued")
      .order("created_at",{ascending:true}).limit(10);
    const commands:any[]=[];
    for(const row of cmdRows||[]){
      const {data:claimed}=await db.from("wa_bridge_commands")
        .update({status:"processing",claimed_at:new Date().toISOString()})
        .eq("id",row.id).eq("status","queued").select("id").maybeSingle();
      if(claimed)commands.push(row);
    }

    const panelJobs:any[]=[];
    if(b?.panel_capable===true){
      const {data:jobRows}=await db.from("wa_panel_jobs")
        .select("*")
        .eq("workspace_id",wid).eq("status","pending")
        .order("created_at",{ascending:true}).limit(12);
      for(const job of jobRows||[]){
        const {data:claimed}=await db.from("wa_panel_jobs")
          .update({status:"processing",started_at:new Date().toISOString()})
          .eq("id",job.id).eq("status","pending").select("*").maybeSingle();
        if(!claimed)continue;
        if(claimed.action_type==="configure_device"){
          const {data:app}=await db.from("wa_app_catalog")
            .select("id,name,enabled,requires_mac_key,activation_driver,activation_url,activation_method,activation_secret_id,activation_payload_template,activation_notes,activation_api_key_header,activation_api_key_prefix")
            .eq("id",claimed.app_catalog_id).eq("workspace_id",wid).maybeSingle();

          if(!app?.enabled||app?.requires_mac_key!==true||!app?.activation_url||!["api","rpa"].includes(String(app?.activation_driver||""))){
            await db.from("wa_panel_jobs").update({status:"waiting_setup",error:"app_activation_not_ready"}).eq("id",claimed.id);
            continue;
          }

          const {data:activationCredentials}=await db.rpc("app_agent_get_activation_credentials",{p_app_id:app.id});
          panelJobs.push({
            ...claimed,
            app_activation:{
              id:app.id,name:app.name,
              requires_mac_key:!!app.requires_mac_key,
              activation_driver:app.activation_driver,
              activation_url:app.activation_url,
              activation_method:app.activation_method||"POST",
              activation_payload_template:app.activation_payload_template||{mac:"{{mac}}",key:"{{key}}"},
              activation_notes:app.activation_notes||null,
              activation_api_key_header:app.activation_api_key_header||"Authorization",
              activation_api_key_prefix:app.activation_api_key_prefix??"Bearer "
            },
            activation_credentials:activationCredentials||{}
          });
          continue;
        }

        const {data:panel}=await db.from("wa_panel_connectors")
          .select("id,name,base_url,login_path,driver_type,provider_type,capabilities,enabled,last_status,credential_secret_id")
          .eq("id",claimed.connector_id).eq("workspace_id",wid).maybeSingle();
        if(!panel?.enabled||!panel?.credential_secret_id){
          await db.from("wa_panel_jobs").update({status:"waiting_setup",error:"panel_not_ready"}).eq("id",claimed.id);
          continue;
        }
        const {data:credentials}=await db.rpc("panel_agent_get_credentials",{p_connector_id:panel.id});
        if(!credentials){
          await db.from("wa_panel_jobs").update({status:"waiting_setup",error:"credentials_unavailable"}).eq("id",claimed.id);
          continue;
        }
        let knownApps:any[]=[];
        if(["probe_login","test","scan_apps"].includes(String(claimed.action_type||""))){
          const [{data:apps},{data:partnerApps}]=await Promise.all([
            db.from("wa_app_catalog")
              .select("id,name,aliases").eq("workspace_id",wid).eq("enabled",true).order("name"),
            db.from("wa_panel_partner_apps")
              .select("app_name").eq("workspace_id",wid).eq("connector_id",claimed.connector_id).eq("enabled",true).order("priority")
          ]);
          knownApps=[
            ...(apps||[]),
            ...(partnerApps||[]).map((a:any)=>({id:"",name:String(a.app_name||""),aliases:[]}))
          ];
        }
        panelJobs.push({...claimed,panel:{...panel,credential_secret_id:undefined},credentials,known_apps:knownApps});
      }
    }

    return json({ok:true,messages:out,commands,panel_jobs:panelJobs});
  }

  if(action==="recover"){
    const cutoff=new Date(Date.now()-120000).toISOString();
    const {data:rows}=await db.from("wa_messages").select("id,metadata")
      .eq("workspace_id",wid).eq("direction","out").eq("status","sending");
    let n=0;
    for(const row of rows||[]){
      const t=row.metadata?.claimed_at;
      if(t&&t<cutoff){
        await db.from("wa_messages").update({status:"queued",metadata:{...(row.metadata||{}),recovered_at:new Date().toISOString()}}).eq("id",row.id);
        n++;
      }
    }
    return json({ok:true,recovered:n});
  }

  if(action==="ack_panel_job"){
    const id=String(b?.job_id||"");
    if(!id)return json({error:"job_id_required"},400);
    const {data:job}=await db.from("wa_panel_jobs").select("*").eq("id",id).eq("workspace_id",wid).maybeSingle();
    if(!job)return json({error:"job_not_found"},404);
    if(job.status==="cancelled")return json({ok:true,cancelled:true});

    const ok=b?.ok===true;
    const result=(b?.result&&typeof b.result==="object")?b.result:{};
    const err=ok?null:String(b?.error||"panel_job_failed").slice(0,1500);
    await db.from("wa_panel_jobs").update({
      status:ok?"done":"failed",result,error:err,completed_at:new Date().toISOString()
    }).eq("id",id).eq("workspace_id",wid);

    if(job.action_type==="probe_login"){
      const nowIso=new Date().toISOString();
      const {data:currentPanel}=await db.from("wa_panel_connectors")
        .select("id,last_status,consecutive_failures,last_success_at")
        .eq("id",job.connector_id).eq("workspace_id",wid).maybeSingle();

      const authenticated=ok&&result?.authenticated===true;
      const nextFailures=authenticated?0:Number(currentPanel?.consecutive_failures||0)+1;
      const hardFailureStatus=String(err||"").includes("panel_url_404")
        ?"url_invalid"
        :(String(err||"").includes("panel_unreachable")?"unreachable":"auth_failed");

      // Não derruba uma sessão boa por falha isolada. Só rebaixa após 3 falhas consecutivas.
      const keepReady=!authenticated
        && currentPanel?.last_status==="driver_ready"
        && nextFailures<3;

      const probeStatus=authenticated
        ?"driver_ready"
        :(keepReady?"driver_ready":hardFailureStatus);

      await db.from("wa_panel_connectors").update({
        last_status:probeStatus,
        consecutive_failures:nextFailures,
        last_success_at:authenticated?nowIso:(currentPanel?.last_success_at||null),
        last_error:authenticated?null:err,
        health_checked_at:nowIso,
        last_checked_at:nowIso,
        updated_at:nowIso
      }).eq("id",job.connector_id).eq("workspace_id",wid);

      if(authenticated){
        const detected=Array.isArray(result?.detected_apps)?result.detected_apps:[];
        for(const a of detected){
          const appId=String(a?.app_catalog_id||"");
          const appName=String(a?.app_name||"").trim();
          if(!appId||!appName)continue;
          await db.from("wa_panel_app_map").upsert({
            workspace_id:wid,connector_id:job.connector_id,app_catalog_id:appId,
            app_name:appName,panel_app_code:String(a?.panel_app_code||appName),
            priority:50,enabled:true,notes:"Detectado automaticamente no painel durante a validação do login.",
            updated_at:new Date().toISOString()
          },{onConflict:"connector_id,app_catalog_id",ignoreDuplicates:true});
        }

        const {data:names}=await db.from("wa_panel_app_map")
          .select("app_name").eq("connector_id",job.connector_id).eq("enabled",true).order("priority");
        await db.from("wa_panel_connectors").update({
          app_names:(names||[]).map((x:any)=>x.app_name),updated_at:new Date().toISOString()
        }).eq("id",job.connector_id).eq("workspace_id",wid);

        await db.from("wa_panel_jobs").update({status:"pending",error:null})
          .eq("workspace_id",wid).eq("connector_id",job.connector_id).eq("status","waiting_setup");
      }
      return json({ok:true,detected_apps:Array.isArray(result?.detected_apps)?result.detected_apps.length:0});
    }

    if(job.action_type==="scan_apps"){
      const searchGroup=String(job?.payload?.search_group||"").trim();
      const appHint=String(job?.payload?.app_hint||"").trim();
      const pendingActivation=(job?.payload?.pending_activation&&typeof job.payload.pending_activation==="object")
        ? job.payload.pending_activation
        : null;

      if(!ok){
        if(searchGroup){
          const {data:open}=await db.from("wa_panel_jobs").select("id")
            .eq("workspace_id",wid)
            .neq("id",job.id)
            .contains("payload",{search_group:searchGroup})
            .in("status",["pending","processing","waiting_setup"])
            .limit(1);
          if(!(open||[]).length){
            await queueCustomerMessage(
              job,
              "Não consegui localizar uma parceria ativa para "+(appHint||"esse aplicativo")+" nos painéis disponíveis. Os dados da tela ficaram salvos e não vou pedir de novo.",
              {panel_action:"panel_partner_search_failed",search_group:searchGroup,app_hint:appHint,error:err}
            );
          }
          return json({ok:true,partner_apps_scan_failed:true,search_group:searchGroup});
        }

        await queueCustomerMessage(
          job,
          "Tentei consultar os aplicativos parceiros direto no servidor, mas o painel não respondeu corretamente. Não vou te passar nomes no chute.",
          {panel_action:"scan_apps_failed",error:err}
        );
        return json({ok:true,partner_apps_scan_failed:true});
      }

      const detected=Array.isArray(result?.detected_apps)?result.detected_apps:[];
      const names=[...new Set(detected.map((a:any)=>String(a?.app_name||"").trim()).filter(Boolean))];

      if(names.length){
        for(let idx=0;idx<names.length;idx++){
          const appName=names[idx];
          const {data:existingPartner}=await db.from("wa_panel_partner_apps")
            .select("id").eq("workspace_id",wid).eq("connector_id",job.connector_id)
            .ilike("app_name",appName).limit(1).maybeSingle();

          if(existingPartner?.id){
            await db.from("wa_panel_partner_apps").update({
              scan_status:"available",
              last_scan_at:new Date().toISOString(),
              updated_at:new Date().toISOString()
            }).eq("id",existingPartner.id);
          }else{
            await db.from("wa_panel_partner_apps").insert({
              workspace_id:wid,
              connector_id:job.connector_id,
              app_name:appName,
              priority:(idx+1)*10,
              platforms:[],
              setup_type:"panel_detected",
              scan_status:"available",
              last_scan_at:new Date().toISOString(),
              enabled:true,
              metadata:{source:"panel_scan"}
            });
          }
        }
      }

      for(const a of detected){
        const appId=String(a?.app_catalog_id||"").trim();
        const appName=String(a?.app_name||"").trim();
        if(!appId||!appName)continue;
        await db.from("wa_panel_app_map").upsert({
          workspace_id:wid,
          connector_id:job.connector_id,
          app_catalog_id:appId,
          app_name:appName,
          panel_app_code:String(a?.panel_app_code||appName),
          priority:50,
          enabled:true,
          notes:"Detectado automaticamente no painel.",
          updated_at:new Date().toISOString()
        },{onConflict:"connector_id,app_catalog_id",ignoreDuplicates:false});
      }

      await db.from("wa_panel_connectors").update({
        app_names:names,
        updated_at:new Date().toISOString()
      }).eq("id",job.connector_id).eq("workspace_id",wid);

      // Busca interna para descobrir em qual painel existe parceria e já configurar o aparelho.
      if(searchGroup&&appHint&&pendingActivation){
        const hintNorm=norm(appHint);
        const match=detected.find((a:any)=>{
          const n=norm(String(a?.app_name||""));
          const c=norm(String(a?.panel_app_code||""));
          return n===hintNorm||n.includes(hintNorm)||hintNorm.includes(n)||c===hintNorm||c.includes(hintNorm);
        });

        if(match){
          await db.from("wa_panel_jobs").update({
            status:"cancelled",
            error:"partner_found_in_other_panel",
            completed_at:new Date().toISOString()
          }).eq("workspace_id",wid)
            .neq("id",job.id)
            .contains("payload",{search_group:searchGroup})
            .in("status",["pending","processing","waiting_setup"]);

          const ins=await db.from("wa_panel_jobs").insert({
            workspace_id:wid,
            contact_id:job.contact_id,
            conversation_id:job.conversation_id,
            connector_id:job.connector_id,
            action_type:"activate_app",
            app_catalog_id:match?.app_catalog_id||null,
            app_name:String(match?.app_name||appHint),
            panel_app_code:String(match?.panel_app_code||match?.app_name||"")||null,
            device_type:String(pendingActivation?.device_type||"Smart TV"),
            customer_name:job.customer_name||null,
            customer_phone:job.customer_phone||null,
            status:"pending",
            payload:{
              mac:String(pendingActivation?.mac||""),
              device_key:String(pendingActivation?.device_key||""),
              playlist_url:String(pendingActivation?.playlist_url||""),
              app_name:String(match?.app_name||appHint),
              panel_app_code:String(match?.panel_app_code||match?.app_name||""),
              source:"panel_partner_auto_match",
              partner_search_group:searchGroup
            }
          }).select("id").single();

          if(ins.error)throw ins.error;
          return json({
            ok:true,
            partner_found:true,
            app_name:String(match?.app_name||appHint),
            connector_id:job.connector_id,
            activation_job_id:ins.data?.id||null
          });
        }

        const {data:open}=await db.from("wa_panel_jobs").select("id")
          .eq("workspace_id",wid)
          .neq("id",job.id)
          .contains("payload",{search_group:searchGroup})
          .in("status",["pending","processing","waiting_setup"])
          .limit(1);
        if(!(open||[]).length){
          await queueCustomerMessage(
            job,
            "Conferi os painéis disponíveis e não encontrei parceria ativa para "+appHint+". Os dados da tela ficaram salvos e você não precisa mandar MAC/Key de novo.",
            {panel_action:"panel_partner_not_found",search_group:searchGroup,app_hint:appHint}
          );
        }
        return json({ok:true,partner_found:false,partner_apps:names,search_group:searchGroup});
      }

      const msg=names.length
        ?"Conferi direto no servidor. Os aplicativos parceiros que apareceram no painel são: "+names.join(", ")+"."
        :"Conferi direto no servidor e o painel não mostrou nenhum aplicativo parceiro listado.";
      await queueCustomerMessage(job,msg,{panel_action:"scan_apps",partner_apps:names});
      return json({ok:true,partner_apps:names});
    }

    if(job.action_type==="configure_device"){
      if(ok){
        const appName=String(job.app_name||result?.app_name||"aplicativo").trim()||"aplicativo";
        const custom=String(result?.customer_message||"").trim();
        const msg=custom||("Prontinho! Já configurei o "+appName+" com o MAC e a Key que você enviou. Agora vá na TV e use Recarregar / Reload / Atualizar lista. Me diga se abriu certinho.");
        await queueCustomerMessage(job,msg,{panel_action:"configure_device",app_name:appName});
      }else{
        await queueCustomerMessage(job,"Recebi o MAC e a Key, mas a configuração automática ainda não concluiu. Vou manter os dados desta conversa para continuar do mesmo ponto.",{panel_action:"configure_device_failed"});
      }
      return json({ok:true});
    }

    if(job.action_type==="activate_app"){
      if(ok){
        const appName=String(job.app_name||result?.app_name||"aplicativo").trim()||"aplicativo";
        await queueCustomerMessage(
          job,
          "Prontinho! Já configurei o "+appName+". Agora aperta em Recarregar / Reload / Atualizar lista no aplicativo e me fala se abriu.",
          {panel_action:"activate_app",app_name:appName,reload_required:true}
        );
      }else{
        await queueCustomerMessage(
          job,
          "A configuração no painel não concluiu. Mantive o MAC e a Key salvos para continuar sem pedir tudo de novo.",
          {panel_action:"activate_app_failed"}
        );
      }
      return json({ok:true});
    }

    if(job.action_type==="test"&&!ok&&job?.payload?.orchestrated_trial===true){
      const candidates=Array.isArray(job.payload?.candidates)?job.payload.candidates:[];
      const currentIndex=Number(job.payload?.candidate_index||0);
      const nextIndex=currentIndex+1;

      if(nextIndex<candidates.length){
        const next=candidates[nextIndex]||{};
        const nextPayload={
          ...(job.payload||{}),
          candidate_index:nextIndex,
          reason:"previous_panel_failed",
          previous_job_id:job.id,
          previous_error:err,
          profile_id:next.profile_id||null,
          profile_name:next.profile_name||null,
          panel_name:next.panel_name||null
        };
        const {data:newJob,error:newJobError}=await db.from("wa_panel_jobs").insert({
          workspace_id:wid,
          contact_id:job.contact_id,
          conversation_id:job.conversation_id,
          connector_id:next.connector_id,
          action_type:"test",
          app_name:String(job.payload?.service_type||"")==="iptv"?String(next.profile_name||"Teste Rápido"):null,
          panel_app_code:String(job.payload?.service_type||"")==="iptv"?(next.panel_code||"Teste Rápido"):null,
          device_type:job.device_type||null,
          screen_count:Number(job.screen_count||1),
          customer_name:job.customer_name||null,
          customer_phone:job.customer_phone||null,
          requested_username:job.requested_username||null,
          status:"pending",
          payload:nextPayload
        }).select("id").single();

        if(!newJobError){
          const {data:contactRow}=await db.from("wa_contacts")
            .select("bot_context").eq("id",job.contact_id).eq("workspace_id",wid).maybeSingle();
          const ctx=(contactRow?.bot_context&&typeof contactRow.bot_context==="object")?contactRow.bot_context:{};
          await db.from("wa_contacts").update({
            bot_context:{
              ...ctx,
              trial_orchestrator:{
                ...(ctx?.trial_orchestrator||{}),
                active:true,
                service_type:String(job.payload?.service_type||""),
                candidates,
                current_index:nextIndex,
                current_connector_id:next.connector_id||null,
                current_panel_name:next.panel_name||null,
                current_profile_name:next.profile_name||null,
                requested_after_trial:String(job.payload?.requested_after_trial||"trial"),
                requested_username:job.payload?.requested_username||null,
                last_job_id:newJob?.id||null,
                updated_at:new Date().toISOString()
              }
            },
            updated_at:new Date().toISOString()
          }).eq("id",job.contact_id).eq("workspace_id",wid);

          await queueCustomerMessage(
            job,
            "Esse painel não concluiu o teste. Já estou tentando a próxima opção: "+String(next.panel_name||"próximo servidor")+" / "+String(next.profile_name||"teste")+".",
            {trial_auto_advanced:true,candidate_index:nextIndex,next_connector_id:next.connector_id||null}
          );
          return json({ok:true,trial_auto_advanced:true,next_job_id:newJob?.id||null});
        }
      }

      await queueCustomerMessage(
        job,
        "Tentei todas as opções de painel disponíveis para esse serviço e nenhuma conseguiu gerar o teste agora.",
        {trial_sequence_exhausted:true,last_error:err}
      );
      if(job.contact_id){
        const {data:contactRow}=await db.from("wa_contacts")
          .select("bot_context").eq("id",job.contact_id).eq("workspace_id",wid).maybeSingle();
        const ctx=(contactRow?.bot_context&&typeof contactRow.bot_context==="object")?contactRow.bot_context:{};
        await db.from("wa_contacts").update({
          bot_context:{...ctx,trial_orchestrator:{...(ctx?.trial_orchestrator||{}),active:false,exhausted:true,last_error:err}},
          updated_at:new Date().toISOString()
        }).eq("id",job.contact_id).eq("workspace_id",wid);
      }
      return json({ok:true,trial_sequence_exhausted:true});
    }

    if(!ok)return json({ok:true});

    const username=String(result?.username||job?.payload?.username||"").trim();
    const expiresAt=cleanIso(result?.expires_at);
    const accessData=accessDataFromResult(result);
    const accessFingerprint=await sha256(JSON.stringify(accessData));
    let existing:any=null;
    if(username&&job.connector_id){
      const ex=await db.from("wa_panel_accounts").select("*")
        .eq("workspace_id",wid).eq("connector_id",job.connector_id).eq("username",username).maybeSingle();
      existing=ex.data||null;
      const history=(job?.payload?.history&&typeof job.payload.history==="object")?job.payload.history:{};
      const resultPlanDays=Number(result?.plan_days||0)||null;
      const inferredPlanDays=Number(job?.history_plan_days||history?.plan_days||0)||null;
      const resolvedPlanDays=resultPlanDays||inferredPlanDays||existing?.plan_days||null;
      const resolvedActivatedAt=cleanIso(result?.activated_at)||cleanIso(history?.activated_at)||cleanIso(job?.history_plan_at)||existing?.activated_at||null;
      const resultScreens=Number(result?.screen_count||0)||null;
      const historyScreens=Number(history?.screen_count||0)||null;
      const resolvedScreens=resultScreens||historyScreens||existing?.screen_count||Number(job?.screen_count||1);
      const historySource=resultPlanDays?"panel":(inferredPlanDays?"whatsapp_history":existing?.history_source||null);
      const historyEvidence=Array.isArray(history?.evidence)?{messages:history.evidence}:existing?.history_evidence||{};

      await db.from("wa_panel_accounts").upsert({
        workspace_id:wid,connector_id:job.connector_id,contact_id:job.contact_id||existing?.contact_id||null,
        external_id:String(result?.external_id||existing?.external_id||"")||null,
        username,
        app_catalog_id:job.app_catalog_id||existing?.app_catalog_id||null,
        app_name:job.app_name||result?.app_name||existing?.app_name||null,
        panel_app_code:job.panel_app_code||existing?.panel_app_code||null,
        screen_count:resolvedScreens,
        account_type:String(result?.account_type||existing?.account_type||"client"),
        status:String(result?.status||existing?.status||"unknown"),
        expires_at:expiresAt||existing?.expires_at||null,
        plan_days:resolvedPlanDays,
        activated_at:resolvedActivatedAt,
        history_source:historySource,
        history_evidence:historyEvidence,
        history_scanned_at:inferredPlanDays?new Date().toISOString():existing?.history_scanned_at||null,
        access_data:accessData,
        access_fingerprint:accessFingerprint,
        last_checked_at:new Date().toISOString(),
        updated_at:new Date().toISOString()
      },{onConflict:"connector_id,username"});
    }

    if(job.action_type==="test"){
      if(result?.created!==false&&username){
        const detected=Array.isArray(result?.partner_apps)?result.partner_apps:[];
        const partnerNames=[...new Set(detected.map((a:any)=>String(a?.app_name||"").trim()).filter(Boolean))];

        if(partnerNames.length){
          for(let idx=0;idx<partnerNames.length;idx++){
            const appName=partnerNames[idx];
            const {data:existingPartner}=await db.from("wa_panel_partner_apps")
              .select("id").eq("workspace_id",wid).eq("connector_id",job.connector_id)
              .ilike("app_name",appName).limit(1).maybeSingle();

            if(existingPartner?.id){
              await db.from("wa_panel_partner_apps").update({
                scan_status:"available",
                last_scan_at:new Date().toISOString(),
                updated_at:new Date().toISOString()
              }).eq("id",existingPartner.id);
            }else{
              await db.from("wa_panel_partner_apps").insert({
                workspace_id:wid,
                connector_id:job.connector_id,
                app_name:appName,
                priority:(idx+1)*10,
                platforms:[],
                setup_type:"panel_detected",
                scan_status:"available",
                last_scan_at:new Date().toISOString(),
                enabled:true,
                metadata:{source:"test_scan"}
              });
            }
          }
        }

        for(const a of detected){
          const appId=String(a?.app_catalog_id||"").trim();
          const appName=String(a?.app_name||"").trim();
          if(!appId||!appName)continue;
          await db.from("wa_panel_app_map").upsert({
            workspace_id:wid,
            connector_id:job.connector_id,
            app_catalog_id:appId,
            app_name:appName,
            panel_app_code:String(a?.panel_app_code||appName),
            priority:50,
            enabled:true,
            notes:"Detectado automaticamente durante a criação do teste.",
            updated_at:new Date().toISOString()
          },{onConflict:"connector_id,app_catalog_id",ignoreDuplicates:false});
        }

        if(partnerNames.length){
          await db.from("wa_panel_connectors").update({
            app_names:partnerNames,
            updated_at:new Date().toISOString()
          }).eq("id",job.connector_id).eq("workspace_id",wid);
        }

        const serviceType=String(job?.payload?.service_type||"").toLowerCase();
        const partnerText=serviceType==="cs"
          ?""
          :(partnerNames.length
            ?"\n\nAplicativos parceiros deste servidor: "+partnerNames.join(", ")+"."
            :"\n\nO painel não mostrou aplicativos parceiros durante a criação deste teste.");
        const profileText=String(job?.payload?.profile_name||"").trim();
        const msg="Seu teste foi criado."
          +(profileText?"\nOpção: "+profileText:"")
          +"\n\n"+accessMessage(result,job)
          +partnerText
          +"\n\nGuarde esses dados. Quando o teste estiver perto de acabar eu volto a falar com você para saber se quer fechar.";
        await queueCustomerMessage(job,msg,{panel_action:"test_created",partner_apps:partnerNames});
        if(expiresAt){
          const {data:acc}=await db.from("wa_panel_accounts").select("id").eq("connector_id",job.connector_id).eq("username",username).maybeSingle();

          // Só o teste atual pode gerar follow-up. Ao criar outro, encerra os anteriores desse cliente.
          await db.from("wa_trial_sessions").update({
            status:"replaced",
            updated_at:new Date().toISOString()
          }).eq("workspace_id",wid)
            .eq("contact_id",job.contact_id)
            .eq("status","active")
            .is("converted_at",null);

          await db.from("wa_trial_sessions").insert({
            workspace_id:wid,contact_id:job.contact_id,conversation_id:job.conversation_id,
            panel_account_id:acc?.id||null,connector_id:job.connector_id,
            app_catalog_id:job.app_catalog_id||null,app_name:job.app_name||result?.app_name||null,
            username,screen_count:Number(result?.screen_count||job.screen_count||1),
            starts_at:new Date().toISOString(),
            expires_at:expiresAt,
            followup_due_at:new Date(new Date(expiresAt).getTime()-10*60*1000).toISOString(),
            status:"active"
          });
        }
      }
      return json({ok:true});
    }

    if(job.action_type==="search_user"||job.action_type==="refresh_access"||job.action_type==="check_codes"){
      const found=result?.found===true||!!username;
      const group=String(job?.payload?.search_group||"");
      if(found){
        if(group){
          await db.from("wa_panel_jobs").update({status:"cancelled",error:"found_in_other_panel",completed_at:new Date().toISOString()})
            .eq("workspace_id",wid).neq("id",job.id).contains("payload",{search_group:group}).in("status",["pending","processing","waiting_setup"]);
        }

        if(String(job?.payload?.after_found_action||"")==="renew"){
          const planDays=Number(job?.payload?.plan_days||job?.plan_days||30);
          const {data:renewJob,error:renewError}=await db.from("wa_panel_jobs").insert({
            workspace_id:wid,
            contact_id:job.contact_id,
            conversation_id:job.conversation_id,
            connector_id:job.connector_id,
            action_type:"renew",
            requested_username:username,
            plan_days:planDays,
            customer_name:job.customer_name||null,
            customer_phone:job.customer_phone||null,
            status:"pending",
            payload:{
              source:"post_trial_renew",
              username,
              plan_days:planDays,
              search_group:group||null
            }
          }).select("id").single();
          if(!renewError){
            await queueCustomerMessage(
              job,
              "Achei seu usuário no painel certo. Já estou fazendo a renovação agora.",
              {panel_action:"renew_started",renew_job_id:renewJob?.id||null,search_group:group}
            );
            return json({ok:true,renew_started:true,renew_job_id:renewJob?.id||null});
          }
        }

        const changed=!!existing&&existing.access_fingerprint&&existing.access_fingerprint!==accessFingerprint;
        const st=String(result?.status||"").toLowerCase();
        let head=st==="expired"||st==="vencido"?"Localizei o usuário. O acesso está vencido.":"Localizei o usuário e consultei o cadastro.";
        if(changed)head+=" Os dados de acesso mudaram; abaixo estão os dados atuais.";
        const body=accessMessage(result,job);
        await queueCustomerMessage(job,head+(body?"\n\n"+body:""),{panel_action:"user_lookup",search_group:group});
      }else if(group){
        const {data:open}=await db.from("wa_panel_jobs").select("id").eq("workspace_id",wid)
          .contains("payload",{search_group:group}).in("status",["pending","processing","waiting_setup"]).limit(1);
        const {data:foundRows}=await db.from("wa_panel_jobs").select("id").eq("workspace_id",wid)
          .contains("payload",{search_group:group}).eq("status","done").contains("result",{found:true}).limit(1);
        if(!(open||[]).length&&!(foundRows||[]).length){
          await queueCustomerMessage(job,"Procurei o usuário nos painéis conectados e não encontrei um cadastro com esse login. Confira se o usuário foi digitado corretamente.",{panel_action:"user_lookup_not_found",search_group:group});
        }
      }
      return json({ok:true});
    }

    if(["activate","create_user","renew"].includes(String(job.action_type))){
      const status=String(result?.status||"active").toLowerCase();
      if(status==="active"||status==="ativo"||result?.activated===true){
        const label=job.action_type==="renew"?"Renovação concluída.":"Ativação concluída.";
        await queueCustomerMessage(job,label+"\n\n"+accessMessage(result,job),{panel_action:job.action_type});
      }
      return json({ok:true});
    }

    return json({ok:true});
  }

  if(action==="ack_command"){
    const id=String(b?.command_id||"");
    if(!id)return json({error:"command_id_required"},400);
    const ok=b?.ok===true;
    let result=(b?.result&&typeof b.result==="object")?b.result:{};
    const err=ok?null:String(b?.error||"command_failed").slice(0,1000);
    const {data:cmdRow}=await db.from("wa_bridge_commands").select("action").eq("id",id).eq("workspace_id",wid).maybeSingle();
    if(ok&&cmdRow?.action==="sync_contacts"){
      const received=Array.isArray(result?.contacts)?result.contacts.length:Number(result?.count||0);
      const imported=await importSyncedContacts(wid,result);
      result={count:received,imported_count:imported};
    }
    const {error}=await db.from("wa_bridge_commands").update({
      status:ok?"done":"failed",result,error:err,completed_at:new Date().toISOString()
    }).eq("id",id).eq("workspace_id",wid);
    if(error)return json({error:"ack_command_failed"},500);

    const nowIso=new Date().toISOString();
    const cfgPatch:any={agent_last_seen:nowIso,updated_at:nowIso};
    if(result.qr_code!==undefined)cfgPatch.qr_code=result.qr_code||null;
    if(result.qr_expires_at!==undefined)cfgPatch.qr_expires_at=result.qr_expires_at||null;
    if(result.external_user_id)cfgPatch.external_user_id=String(result.external_user_id);
    if(result.status)cfgPatch.last_status=String(result.status);
    if(result.connected===true){cfgPatch.qr_code=null;cfgPatch.qr_expires_at=null}
    await db.from("wa_bridge_configs").update(cfgPatch).eq("workspace_id",wid);

    if(result.connected===true||result.connected===false){
      const settingsPatch:any={bridge_connected:result.connected===true,updated_at:nowIso};
      if(result.connected===true&&result.jid)settingsPatch.bridge_phone=String(result.jid);
      if(result.connected===true&&result.name)settingsPatch.bridge_name=String(result.name);
      await db.from("wa_settings").update(settingsPatch).eq("workspace_id",wid);
    }
    return json({ok:true});
  }

  if(action==="ack"){
    const id=String(b?.message_id||"");
    if(!id)return json({error:"message_id_required"},400);
    const {data:row}=await db.from("wa_messages").select("metadata").eq("id",id).eq("workspace_id",wid).maybeSingle();
    if(!row)return json({error:"not_found"},404);
    const ok=b?.ok===true;
    const external=String(b?.external_message_id||"")||null;
    const meta={...(row.metadata||{}),completed_at:new Date().toISOString()};
    if(!ok)meta.error=String(b?.error||"send_failed").slice(0,500);
    const patch:any={status:ok?"sent":"failed",metadata:meta};
    if(ok&&external)patch.external_message_id=external;
    const {error}=await db.from("wa_messages").update(patch).eq("id",id).eq("workspace_id",wid);
    return error?json({error:"ack_failed"},500):json({ok:true});
  }

  return json({error:"unknown_action"},400);
});
