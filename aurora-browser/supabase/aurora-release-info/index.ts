Deno.serve((req: Request) => {
const headers={"Access-Control-Allow-Origin":"https://juliovianadeoliveira-source.github.io","Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"GET,OPTIONS","Cache-Control":"no-store","Content-Type":"application/json; charset=utf-8"};
if(req.method==="OPTIONS")return new Response(null,{headers});
if(req.method!=="GET")return new Response(JSON.stringify({error:"Método não permitido"}),{status:405,headers});
return new Response(JSON.stringify({name:"Aurora",version:"0.1.0",channel:"preview",release:"https://github.com/juliovianadeoliveira-source/aplicativo-iptv-web/releases/tag/aurora-v0.1.0",platforms:["windows-x64","android"],automaticUpdates:false}),{headers});
});
