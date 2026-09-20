#!/usr/bin/env python3
import json, time, urllib.request, urllib.error, subprocess, os, sys

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

def post_json(url, body, token_header=True, timeout=20):
    data=json.dumps(body,ensure_ascii=False).encode("utf-8")
    headers={"Content-Type":"application/json"}
    if token_header:
        headers["token"]=TOKEN
    req=urllib.request.Request(url,data=data,headers=headers,method="POST")
    with urllib.request.urlopen(req,timeout=timeout) as r:
        raw=r.read().decode("utf-8","replace")
        return json.loads(raw) if raw else {}

def cloud(action, **kwargs):
    return post_json(CLOUD,{"action":action,**kwargs})

def wuz(path, body):
    return post_json(WUZ+path,body)

def presence(phone,state):
    try:
        wuz("/chat/presence",{"Phone":phone,"State":state,"Media":""})
    except Exception:
        pass

def send_text(phone, body):
    return wuz("/chat/send/text",{"Phone":phone,"Body":body})

def ack(mid, ok, external_id=None, error=None):
    payload={"message_id":mid,"ok":bool(ok)}
    if external_id: payload["external_message_id"]=external_id
    if error: payload["error"]=str(error)[:500]
    try: cloud("ack",**payload)
    except Exception: pass

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
            data=cloud("pull")
            rows=data.get("messages",[])
            if not rows:
                time.sleep(1.4)
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
