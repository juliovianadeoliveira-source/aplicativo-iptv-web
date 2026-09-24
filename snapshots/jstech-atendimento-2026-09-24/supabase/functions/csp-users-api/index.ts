import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
const esc=(v:unknown)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]!));
Deno.serve(async(req)=>{
 if(req.method!=="GET"&&req.method!=="HEAD")return new Response("Method not allowed",{status:405});
 const key=new URL(req.url).searchParams.get("key")||"";
 if(!/^[a-f0-9]{48}$/i.test(key))return new Response("<xml-user-manager ver=\"1.0\"></xml-user-manager>",{status:403,headers:{"content-type":"text/xml; charset=utf-8"}});
 const {data:server}=await sb.from("csp_servers").select("id").eq("api_key",key).eq("api_enabled",true).eq("enabled",true).maybeSingle();
 if(!server)return new Response("<xml-user-manager ver=\"1.0\"></xml-user-manager>",{status:403,headers:{"content-type":"text/xml; charset=utf-8"}});
 const today=new Date().toISOString().slice(0,10);
 const {data:users,error}=await sb.from("panel_users").select("username,password,profile,max_connections").eq("csp_server_id",server.id).eq("xml_enabled",true).eq("blocked",false).or(`expires_at.is.null,expires_at.gte.${today}`).order("username");
 if(error)return new Response("<xml-user-manager ver=\"1.0\"></xml-user-manager>",{status:500,headers:{"content-type":"text/xml; charset=utf-8"}});
 await sb.from("csp_servers").update({xml_last_access_at:new Date().toISOString()}).eq("id",server.id);
 const body='<xml-user-manager ver="1.0">\n'+(users||[]).map(u=>`<user name="${esc(u.username)}" password="${esc(u.password)}" display-name="${esc(u.username)}" profiles="${esc(u.profile)}" max-connections="${Math.max(1,Number(u.max_connections)||1)}" />`).join("\n")+'\n</xml-user-manager>';
 return new Response(req.method==="HEAD"?null:body,{headers:{"content-type":"text/xml; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
});