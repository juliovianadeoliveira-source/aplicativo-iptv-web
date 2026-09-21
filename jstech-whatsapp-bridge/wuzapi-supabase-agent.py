#!/usr/bin/env python3
import json, time, urllib.request, urllib.error, subprocess, os, sys
from datetime import datetime, timezone, timedelta

CLOUD="https://fvttsguxeocisqvcrbqh.supabase.co/functions/v1/jstech-wa-wuzapi-agent"
WUZ="http://127.0.0.1:8080"
CREDS="/root/wuzapi-credentials.txt"

def read_token():
    with open(CREDS,"r",encoding="utf-8") as f:
        for line in f:
            if line.startswith("USER_TOKEN="):
                return line.split("=",1)[1].strip()
    raise RuntimeError("USER_TOKEN não encontrado em "+CREDS)

TOKEN=read_token()

def read_admin_token():
    for path in [CREDS,"/opt/wuzapi/.env"]:
        try:
            with open(path,"r",encoding="utf-8",errors="ignore") as f:
                for line in f:
                    if "=" not in line: continue
                    k,v=line.strip().split("=",1)
                    if k in ("WUZAPI_ADMIN_TOKEN","ADMIN_TOKEN") and v.strip():
                        return v.strip().strip('"').strip("'")
        except Exception:
            pass
    return ""

def http_json(url, method="POST", body=None, headers=None, timeout=20):
    data=None if body is None else json.dumps(body,ensure_ascii=False).encode("utf-8")
    h={"Accept":"application/json"}
    if data is not None: h["Content-Type"]="application/json"
    if headers: h.update(headers)
    req=urllib.request.Request(url,data=data,headers=h,method=method)
    with urllib.request.urlopen(req,timeout=timeout) as r:
        raw=r.read().decode("utf-8","replace")
        return json.loads(raw) if raw else {}

def post_json(url, body, token_header=True, timeout=20):
    headers={}
    if token_header: headers["token"]=TOKEN
    return http_json(url,"POST",body,headers,timeout)

def cloud(action, **kwargs):
    return post_json(CLOUD,{"action":action,**kwargs})

def wuz(path, body, token=None):
    return http_json(WUZ+path,"POST",body,{"token":token or TOKEN},25)

def wuz_get(path, token=None):
    return http_json(WUZ+path,"GET",None,{"token":token or TOKEN},25)

def wuz_admin(path, body=None, method="GET"):
    adm=read_admin_token()
    if not adm: raise RuntimeError("WUZAPI_ADMIN_TOKEN não encontrado")
    return http_json(WUZ+path,method,body,{"Authorization":adm},25)

def presence(phone,state,token=None):
    try:
        wuz("/chat/presence",{"Phone":phone,"State":state,"Media":""},token)
    except Exception:
        pass

def send_text(phone, body, token=None):
    return wuz("/chat/send/text",{"Phone":phone,"Body":body},token)

def ack(mid, ok, external_id=None, error=None):
    payload={"message_id":mid,"ok":bool(ok)}
    if external_id: payload["external_message_id"]=external_id
    if error: payload["error"]=str(error)[:500]
    try: cloud("ack",**payload)
    except Exception: pass

def host_ack_message(wid,mid,ok,external_id=None,error=None):
    p={"workspace_id":wid,"message_id":mid,"ok":bool(ok)}
    if external_id: p["external_message_id"]=external_id
    if error: p["error"]=str(error)[:500]
    try: cloud("host_ack_message",**p)
    except Exception: pass

def host_ack_command(wid,cid,ok,result=None,error=None):
    p={"workspace_id":wid,"command_id":cid,"ok":bool(ok),"result":result or {}}
    if error: p["error"]=str(error)[:1000]
    try: cloud("host_ack_command",**p)
    except Exception: pass

def ensure_hosted_user(name,token,sig):
    rows=wuz_admin("/admin/users",method="GET")
    if isinstance(rows,dict): rows=rows.get("data") or rows.get("users") or []
    if not isinstance(rows,list): rows=[]
    found=any(str(x.get("name",""))==name or str(x.get("token",""))==token for x in rows)
    if not found:
        wuz_admin("/admin/users",{"name":name,"token":token},"POST")
    hook="https://fvttsguxeocisqvcrbqh.supabase.co/functions/v1/jstech-wa-wuzapi-webhook?token="+sig
    wuz("/webhook",{"webhookurl":hook,"events":["Message","Connected","Disconnected","KeepAliveRestored","KeepAliveTimeout","LoggedOut"]},token)

def hosted_connect(token):
    try: wuz("/session/connect",{"Subscribe":["All"],"Immediate":True},token)
    except Exception: pass
    for _ in range(8):
        time.sleep(.8)
        st=wuz_get("/session/status",token)
        d=st.get("data",{}) if isinstance(st,dict) else {}
        logged=bool(d.get("loggedIn") or d.get("LoggedIn"))
        if logged:
            return {"connected":True,"ready":True,"status":"connected","qr_code":None,"qr_expires_at":None}
        try:
            q=wuz_get("/session/qr",token)
            qd=q.get("data",{}) if isinstance(q,dict) else {}
            qr=qd.get("QRCode") or qd.get("qrcode")
            if isinstance(qr,str) and qr.startswith("data:image"):
                exp=(datetime.now(timezone.utc)+timedelta(seconds=115)).isoformat()
                return {"connected":False,"ready":True,"status":"waiting_qr","qr_code":qr,"qr_expires_at":exp}
        except Exception: pass
    raise RuntimeError("QR Code ainda não foi gerado")

def process_host_command(cmd):
    wid=str(cmd.get("workspace_id","")); cid=str(cmd.get("id",""))
    action=str(cmd.get("action","")); token=str(cmd.get("wuz_token",""))
    name=str(cmd.get("instance_name","") or ("rev-"+wid[:8])); sig=str(cmd.get("webhook_sig",""))
    try:
        if action=="provision":
            ensure_hosted_user(name,token,sig); result=hosted_connect(token)
        elif action=="connect":
            result=hosted_connect(token)
        elif action=="logout":
            try: wuz("/session/logout",{},token)
            except Exception: pass
            result={"connected":False,"ready":True,"status":"logged_out","qr_code":None,"qr_expires_at":None}
        else:
            result={"connected":False,"ready":True,"status":"offline"}
        host_ack_command(wid,cid,True,result=result)
    except Exception as e:
        host_ack_command(wid,cid,False,error=e)

def process_host_message(m):
    wid=str(m.get("workspace_id","")); mid=str(m.get("id",""))
    phone=str(m.get("phone","")).strip(); body=str(m.get("body","")); token=str(m.get("wuz_token",""))
    if not mid or not wid or not phone or not body or not token:
        host_ack_message(wid,mid,False,error="payload inválido"); return
    try:
        delay=max(250,min(int(m.get("delay_ms") or 700),5000))
        presence(phone,"composing",token); time.sleep(delay/1000.0)
        result=send_text(phone,body,token); presence(phone,"paused",token)
        ok=bool(result.get("success",False)); d=result.get("data") or {}; ext=d.get("Id") or d.get("id")
        host_ack_message(wid,mid,ok,external_id=ext,error=None if ok else json.dumps(result,ensure_ascii=False)[:500])
    except Exception as e:
        presence(phone,"paused",token); host_ack_message(wid,mid,False,error=e)

def main():
    try: cloud("recover")
    except Exception: pass
    last_hb=0
    while True:
        try:
            now=time.time()
            if now-last_hb>25:
                cloud("heartbeat")
                last_hb=now
            host=cloud("host_pull")
            for cmd in host.get("commands",[]) or []:
                process_host_command(cmd)
            for hm in host.get("messages",[]) or []:
                process_host_message(hm)

            data=cloud("pull")
            rows=data.get("messages",[])
            if not rows and not host.get("messages") and not host.get("commands"):
                time.sleep(1.0)
                continue
            for m in rows:
                mid=str(m.get("id",""))
                phone=str(m.get("phone","")).strip()
                body=str(m.get("body",""))
                delay=max(400,min(int(m.get("delay_ms") or 1200),5000))
                if not mid or not phone or not body:
                    ack(mid,False,error="payload inválido")
                    continue
                try:
                    presence(phone,"composing")
                    time.sleep(delay/1000.0)
                    result=send_text(phone,body)
                    presence(phone,"paused")
                    ok=bool(result.get("success",False))
                    ext=(result.get("data") or {}).get("Id") or (result.get("data") or {}).get("id")
                    if ok:
                        ack(mid,True,external_id=ext)
                    else:
                        ack(mid,False,error=json.dumps(result,ensure_ascii=False)[:500])
                except Exception as e:
                    presence(phone,"paused")
                    ack(mid,False,error=e)
            time.sleep(.3)
        except KeyboardInterrupt:
            return
        except Exception as e:
            print("agent error:",e,flush=True)
            time.sleep(5)

if __name__=="__main__":
    main()
