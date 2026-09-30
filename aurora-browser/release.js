'use strict';
document.getElementById('version').onclick=async()=>{
 const status=document.getElementById('status'); status.textContent='Consultando versão…';
 try{
 const response=await fetch('https://fvttsguxeocisqvcrbqh.supabase.co/functions/v1/aurora-release-info',{headers:{Authorization:'Bearer '+"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ2dHRzZ3V4ZW9jaXNxdmNyYnFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5OTE1ODMsImV4cCI6MjEwNDU2NzU4M30.UgbjTaFX0CXPe0FYP_vJwXNl6TvDw7nmzBMFj4mCenQ",apikey:"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ2dHRzZ3V4ZW9jaXNxdmNyYnFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5OTE1ODMsImV4cCI6MjEwNDU2NzU4M30.UgbjTaFX0CXPe0FYP_vJwXNl6TvDw7nmzBMFj4mCenQ"},credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
 if(!response.ok) throw new Error('Não foi possível consultar a versão.');
 const info=await response.json();status.textContent=info.name+' '+info.version+' · Prévia para Windows e Android. Abra os arquivos acima para baixar.';
 }catch(error){status.textContent=error.message+' Os links de download continuam disponíveis.'}
};
