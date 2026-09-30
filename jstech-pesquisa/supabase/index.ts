Deno.serve(async (req: Request) => {
 const headers = {"Access-Control-Allow-Origin":"https://juliovianadeoliveira-source.github.io","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"GET, OPTIONS","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
 if(req.method==="OPTIONS") return new Response(null,{headers});
 if(req.method!=="GET") return new Response(JSON.stringify({error:"Método inválido"}),{status:405,headers});
 const q=new URL(req.url).searchParams.get("q")?.trim()||"";
 if(q.length<2||q.length>200) return new Response(JSON.stringify({error:"Digite entre 2 e 200 caracteres."}),{status:400,headers});
 const url=new URL("https://pt.wikipedia.org/w/api.php");
 url.search=new URLSearchParams({action:"query",list:"search",srsearch:q,srlimit:"10",format:"json"}).toString();
 try{
 const res=await fetch(url,{signal:AbortSignal.timeout(8000),headers:{"User-Agent":"JSTechPesquisa/1.0"}});
 if(!res.ok) throw new Error("provider");
 const data=await res.json();
 return new Response(JSON.stringify({provider:"Wikipédia",results:(data.query?.search||[]).map((x:any)=>({title:x.title,description:x.snippet.replace(/<[^>]*>/g,""),url:"https://pt.wikipedia.org/?curid="+x.pageid}))}),{headers});
 }catch{return new Response(JSON.stringify({error:"A Wikipédia está indisponível. Use a busca na web."}),{status:502,headers});}
});