
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const cors={
  "access-control-allow-origin":"*",
  "access-control-allow-headers":"authorization, x-client-info, apikey, content-type",
};
const reply=(d:any,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...cors,"content-type":"application/json; charset=utf-8"}});
const URL=Deno.env.get("SUPABASE_URL")!;
const legacy=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const sj=Deno.env.get("SUPABASE_SECRET_KEYS");
const SERVICE=sj?JSON.parse(sj)["default"]:legacy;
if(!SERVICE)throw new Error("backend key unavailable");
const db=createClient(URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});

async function evo(config:any,path:string,body:any){
  const res=await fetch(String(config.base_url).replace(/\/+$/,"")+path,{
    method:"POST",
    headers:{"apikey":config.api_key,"content-type":"application/json"},
    body:JSON.stringify(body)
  });
  const data=await res.json().catch(()=>({}));
  return {ok:res.ok,status:res.status,data};
}
async function sendEvolution(config:any,number:string,text:string){
  const path="/message/sendText/"+encodeURIComponent(config.instance_name);
  let r=await evo(config,path,{number,text});
  if(!r.ok&&[400,404,422].includes(r.status)){
    r=await evo(config,path,{number,options:{delay:300,presence:"composing"},textMessage:{text}});
  }
  return r;
}
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return reply({error:"method_not_allowed"},405);

  const jwt=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!jwt)return reply({error:"unauthorized"},401);
  const {data:ud,error:ue}=await db.auth.getUser(jwt);
  const user=ud?.user;
  if(ue||!user)return reply({error:"unauthorized"},401);

  let b:any;try{b=await req.json()}catch{return reply({error:"invalid_json"},400)}
  const conversationId=String(b?.conversation_id||"");
  const text=String(b?.text||"").trim();
  if(!conversationId||!text)return reply({error:"conversation_id_and_text_required"},400);

  const {data:conv}=await db.from("wa_conversations").select("id,workspace_id,contact_id,connection_slot").eq("id",conversationId).maybeSingle();
  if(!conv)return reply({error:"conversation_not_found"},404);
  const {data:w}=await db.from("wa_workspaces").select("id,owner_id").eq("id",conv.workspace_id).maybeSingle();
  if(!w||w.owner_id!==user.id)return reply({error:"forbidden"},403);
  const slot=Number(conv.connection_slot||1);
  const {data:contact}=await db.from("wa_contacts").select("id,phone,bot_context,memory_context").eq("id",conv.contact_id).maybeSingle();
  const {data:settings}=await db.from("wa_settings").select("bridge_connected,connection_mode").eq("workspace_id",conv.workspace_id).maybeSingle();
  let bridge:any=null;
  let connected=false;
  if(slot===1){
    const {data}=await db.from("wa_bridge_configs").select("*").eq("workspace_id",conv.workspace_id).maybeSingle();
    bridge=data;
    connected=!!settings?.bridge_connected;
    if(bridge?.provider==="wuzapi-local" && bridge?.agent_last_seen){
      connected=connected && (Date.now()-Date.parse(bridge.agent_last_seen)<120000);
    }
  }else{
    const {data}=await db.from("wa_extra_bridge_configs").select("*")
      .eq("workspace_id",conv.workspace_id).eq("connection_slot",slot).maybeSingle();
    bridge=data;
    connected=!!bridge && String(bridge.last_status||"").toLowerCase()==="connected"
      && !!bridge.agent_last_seen && (Date.now()-Date.parse(bridge.agent_last_seen)<120000);
  }
  if(!contact?.phone)return reply({error:"contact_phone_missing"},409);
  if(!bridge||settings?.connection_mode!=="qr"||!connected)return reply({error:"whatsapp_not_connected"},409);

  if(["wuzapi-local","wuzapi-hosted"].includes(bridge.provider)){
    const {data:saved,error}=await db.from("wa_messages").insert({
      workspace_id:conv.workspace_id,conversation_id:conv.id,contact_id:contact.id,connection_slot:slot,
      direction:"out",sender_type:"human",content:text,message_type:"text",status:"queued",
      metadata:{provider:bridge.provider,to_phone:contact.phone,delay_ms:350,operator_user_id:user.id,connection_slot:slot}
    }).select("id,created_at,status").single();
    if(error)return reply({error:"message_saved_failed"},500);

    const takeoverUntil=new Date(Date.now()+3*60*1000).toISOString();
    await Promise.all([
      db.from("wa_contacts").update({
        bot_enabled:false,
        bot_context:{...(contact.memory_context||{}),...(contact.bot_context||{}),human_takeover_until:takeoverUntil,manual_pause:false},
        updated_at:new Date().toISOString()
      }).eq("id",contact.id),
      db.from("wa_conversations").update({
        last_message_at:new Date().toISOString(),
        unread_count:0,
        status:"atendimento_humano"
      }).eq("id",conv.id)
    ]);
    return reply({ok:true,queued:true,message:saved,human_takeover:true,human_takeover_until:takeoverUntil});
  }

  const sent=await sendEvolution(bridge,contact.phone,text);
  if(!sent.ok)return reply({error:"whatsapp_send_failed",detail:sent.data},502);
  const externalId=sent.data?.key?.id??sent.data?.data?.key?.id??sent.data?.message?.key?.id??null;
  const {data:saved,error}=await db.from("wa_messages").insert({
    workspace_id:conv.workspace_id,conversation_id:conv.id,contact_id:contact.id,connection_slot:slot,
    direction:"out",sender_type:"human",content:text,message_type:"text",
    external_message_id:externalId,status:"sent",metadata:{provider:"evolution",connection_slot:slot}
  }).select("id,created_at").single();
  if(error)return reply({error:"message_saved_failed"},500);
  const takeoverUntil=new Date(Date.now()+3*60*1000).toISOString();
  await Promise.all([
    db.from("wa_contacts").update({
      bot_enabled:false,
      bot_context:{...(contact.memory_context||{}),...(contact.bot_context||{}),human_takeover_until:takeoverUntil,manual_pause:false},
      updated_at:new Date().toISOString()
    }).eq("id",contact.id),
    db.from("wa_conversations").update({
      last_message_at:new Date().toISOString(),
      unread_count:0,
      status:"atendimento_humano"
    }).eq("id",conv.id)
  ]);
  return reply({ok:true,message:saved,external_message_id:externalId,human_takeover:true,human_takeover_until:takeoverUntil});
});
