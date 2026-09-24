import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import bcrypt from "npm:bcryptjs@2.4.3";

const url=Deno.env.get("SUPABASE_URL")!;
const legacy=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const secretJson=Deno.env.get("SUPABASE_SECRET_KEYS");
const service=secretJson?JSON.parse(secretJson)["default"]:legacy;
const pubJson=Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
const publishable=pubJson?JSON.parse(pubJson)["default"]:Deno.env.get("SUPABASE_ANON_KEY");
if(!service||!publishable)throw new Error("Supabase keys unavailable");

const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
const json=(d:any,s=200)=>new Response(JSON.stringify(d),{
  status:s,
  headers:{
    "content-type":"application/json; charset=utf-8",
    "access-control-allow-origin":"*",
    "access-control-allow-headers":"content-type, apikey"
  }
});

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:{
    "access-control-allow-origin":"*",
    "access-control-allow-headers":"content-type, apikey",
    "access-control-allow-methods":"POST, OPTIONS"
  }});
  if(req.method!=="POST")return json({error:"method_not_allowed"},405);

  let b:any;try{b=await req.json()}catch{return json({error:"invalid_json"},400)}
  const username=String(b?.username||"").trim().toLowerCase();
  const password=String(b?.password||"");
  if(!username||!password)return json({error:"Usuário ou senha inválidos."},400);

  const {data:a,error:aerr}=await admin
    .from("wa_login_aliases")
    .select("auth_user_id,auth_email,active,password_hash")
    .ilike("username",username)
    .maybeSingle();

  if(aerr||!a?.active)return json({error:"Usuário ou senha inválidos."},401);

  if(a.password_hash){
    const ok=bcrypt.compareSync(password,a.password_hash);
    if(!ok)return json({error:"Usuário ou senha inválidos."},401);

    const {error:upErr}=await admin.auth.admin.updateUserById(a.auth_user_id,{password});
    if(upErr)return json({error:"Não foi possível atualizar a senha do acesso."},500);
  }

  const client=createClient(url,publishable,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await client.auth.signInWithPassword({email:a.auth_email,password});
  if(error||!data.session)return json({error:"Usuário ou senha inválidos."},401);

  return json({
    access_token:data.session.access_token,
    refresh_token:data.session.refresh_token,
    expires_in:data.session.expires_in,
    user:data.user
  });
});