#!/usr/bin/env python3
import json, time, urllib.request, urllib.error, subprocess, os, sys, re, hashlib, base64, tempfile, threading
from datetime import datetime, timezone, timedelta
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

try:
    from playwright.sync_api import sync_playwright
    HAS_PLAYWRIGHT=True
except Exception:
    sync_playwright=None
    HAS_PLAYWRIGHT=False

PANEL_SESSION_DIR=Path("/var/lib/jstech-panel-sessions")
try:
    PANEL_SESSION_DIR.mkdir(parents=True,exist_ok=True)
    os.chmod(PANEL_SESSION_DIR,0o700)
except Exception:
    pass

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

# O agente local não altera a resposta produzida pela IA.
# Ele apenas transporta a mensagem para o WhatsApp.
def guard_repeated_reply(phone, body):
    return body

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
    try:
        env=subprocess.check_output(["systemctl","show","wuzapi","-p","Environment","--value"],text=True,timeout=5)
        for part in env.split():
            if part.startswith("WUZAPI_ADMIN_TOKEN="):
                return part.split("=",1)[1].strip().strip('"').strip("'")
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

def contact_avatar(phone, token=None):
    try:
        r=wuz("/user/avatar",{"Phone":phone,"Preview":False},token)
        data=r.get("data",r) if isinstance(r,dict) else {}
        if isinstance(data,dict):
            return str(data.get("URL") or data.get("Url") or data.get("url") or "").strip()
    except Exception:
        pass
    return ""

def fetch_contacts(token=None):
    r=wuz_get("/user/contacts",token)
    data=r.get("data",{}) if isinstance(r,dict) else {}
    rows=[]
    if isinstance(data,dict):
        for jid,info in data.items():
            jid=str(jid or "")
            if not jid.endswith("@s.whatsapp.net"):
                continue
            phone=jid.split("@",1)[0].split(":",1)[0]
            phone=re.sub(r"\D+","",phone)
            if len(phone)<10 or len(phone)>15:
                continue
            info=info or {}
            name=(
                str(info.get("BusinessName") or "").strip()
                or str(info.get("FullName") or "").strip()
                or str(info.get("FirstName") or "").strip()
                or str(info.get("PushName") or "").strip()
                or phone
            )
            rows.append({"phone":phone,"name":name,"profile_photo_url":""})

    if rows:
        def fill_avatar(row):
            row["profile_photo_url"]=contact_avatar(row["phone"],token)
            return row
        try:
            workers=min(12,max(1,len(rows)))
            with ThreadPoolExecutor(max_workers=workers) as pool:
                rows=list(pool.map(fill_avatar,rows))
        except Exception:
            pass

    return {
        "contacts":rows,
        "count":len(rows),
        "photos_count":sum(1 for x in rows if x.get("profile_photo_url"))
    }

def ensure_local_webhook():
    sig=hashlib.sha256(TOKEN.encode("utf-8")).hexdigest()
    hook="https://fvttsguxeocisqvcrbqh.supabase.co/functions/v1/jstech-wa-wuzapi-webhook?token="+sig
    body={
        "webhookurl":hook,
        "events":["Message","CallOffer","Connected","Disconnected","KeepAliveRestored","KeepAliveTimeout","LoggedOut"]
    }
    return wuz("/webhook",body,TOKEN)

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

def send_image(phone, caption, image_data_uri, token=None):
    return wuz("/chat/send/image",{
        "Phone":phone,
        "Caption":caption or "",
        "Image":image_data_uri,
    },token)

def send_audio(phone, audio_data_uri, token=None):
    return wuz("/chat/send/audio",{
        "Phone":phone,
        "Audio":audio_data_uri,
    },token)

def reject_call(call_from, call_id, token=None):
    return wuz("/call/reject",{"call_from":call_from,"call_id":call_id},token)

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

def ack_command(cid,ok,result=None,error=None):
    p={"command_id":cid,"ok":bool(ok),"result":result or {}}
    if error: p["error"]=str(error)[:1000]
    try: cloud("ack_command",**p)
    except Exception: pass

def ensure_hosted_user(name,token,sig):
    rows=wuz_admin("/admin/users",method="GET")
    if isinstance(rows,dict): rows=rows.get("data") or rows.get("users") or []
    if not isinstance(rows,list): rows=[]
    found=any(str(x.get("name",""))==name or str(x.get("token",""))==token for x in rows)
    if not found:
        wuz_admin("/admin/users",{"name":name,"token":token},"POST")
    hook="https://fvttsguxeocisqvcrbqh.supabase.co/functions/v1/jstech-wa-wuzapi-webhook?token="+sig
    wuz("/webhook",{"webhookurl":hook,"events":["Message","CallOffer","Connected","Disconnected","KeepAliveRestored","KeepAliveTimeout","LoggedOut"]},token)

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
                exp=(datetime.now(timezone.utc)+timedelta(seconds=70)).isoformat()
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
        elif action=="status":
            st=wuz_get("/session/status",token)
            d=st.get("data",{}) if isinstance(st,dict) else {}
            connected=bool(d.get("loggedIn") or d.get("LoggedIn"))
            if connected:
                result={"connected":True,"ready":True,"status":"connected","qr_code":None,"qr_expires_at":None}
            else:
                result=None
                try:
                    q=wuz_get("/session/qr",token)
                    qd=q.get("data",{}) if isinstance(q,dict) else {}
                    qr=qd.get("QRCode") or qd.get("qrcode")
                    if isinstance(qr,str) and qr.startswith("data:image"):
                        result={
                            "connected":False,"ready":True,"status":"waiting_qr",
                            "qr_code":qr,
                            "qr_expires_at":(datetime.now(timezone.utc)+timedelta(seconds=70)).isoformat()
                        }
                except Exception:
                    pass
                if result is None:
                    result=hosted_connect(token)
        elif action=="logout":
            try: wuz("/session/logout",{},token)
            except Exception: pass
            result={"connected":False,"ready":True,"status":"logged_out","qr_code":None,"qr_expires_at":None}
        elif action=="reject_call":
            p=cmd.get("payload") or {}
            call_from=str(p.get("call_from","")).strip()
            call_id=str(p.get("call_id","")).strip()
            if not call_from or not call_id: raise RuntimeError("dados da ligação incompletos")
            reject_call(call_from,call_id,token)
            result={"rejected":True,"call_id":call_id}
        elif action=="download_media":
            result=download_media_and_reinject(cmd.get("payload") or {},token)
        elif action=="sync_contacts":
            result=fetch_contacts(token)
        else:
            raise RuntimeError("ação desconhecida: "+action)
        host_ack_command(wid,cid,True,result=result)
    except Exception as e:
        host_ack_command(wid,cid,False,error=e)

def process_host_message(m):
    wid=str(m.get("workspace_id","")); mid=str(m.get("id",""))
    phone=str(m.get("phone","")).strip(); body=str(m.get("body","")); token=str(m.get("wuz_token",""))
    body=guard_repeated_reply(phone,body)
    image_data_uri=str(m.get("image_data_uri") or "").strip()
    audio_data_uri=str(m.get("audio_data_uri") or "").strip()
    if not mid or not wid or not phone or (not body and not image_data_uri and not audio_data_uri) or not token:
        host_ack_message(wid,mid,False,error="payload inválido"); return
    try:
        delay=max(250,min(int(m.get("delay_ms") or 700),5000))
        presence(phone,"composing",token); time.sleep(delay/1000.0)
        if audio_data_uri:
            result=send_audio(phone,audio_data_uri,token)
        elif image_data_uri:
            result=send_image(phone,body,image_data_uri,token)
        else:
            result=send_text(phone,body,token)
        presence(phone,"paused",token)
        ok=bool(result.get("success",False)); d=result.get("data") or {}; ext=d.get("Id") or d.get("id")
        host_ack_message(wid,mid,ok,external_id=ext,error=None if ok else json.dumps(result,ensure_ascii=False)[:500])
    except Exception as e:
        presence(phone,"paused",token); host_ack_message(wid,mid,False,error=e)


def panel_browser_available():
    return bool(HAS_PLAYWRIGHT)

def panel_session_path(panel_id):
    safe=re.sub(r"[^A-Za-z0-9_-]","_",str(panel_id or "panel"))
    return str(PANEL_SESSION_DIR/(safe+".json"))

def _body_text(page):
    try:
        return page.locator("body").inner_text(timeout=3000)
    except Exception:
        return ""

def _norm_text(s):
    s=str(s or "").lower()
    repl={"á":"a","à":"a","ã":"a","â":"a","é":"e","ê":"e","í":"i","ó":"o","ô":"o","õ":"o","ú":"u","ç":"c"}
    for a,b in repl.items(): s=s.replace(a,b)
    return re.sub(r"\s+"," ",s).strip()

def _first_visible(locator):
    try:
        n=min(locator.count(),25)
        for i in range(n):
            x=locator.nth(i)
            try:
                if x.is_visible(): return x
            except Exception:
                pass
    except Exception:
        pass
    return None

def _find_input(page, kind):
    loc=page.locator("input")
    best=None; best_score=-1
    try:
        n=min(loc.count(),40)
    except Exception:
        n=0
    for i in range(n):
        el=loc.nth(i)
        try:
            if not el.is_visible(): continue
            typ=(el.get_attribute("type") or "text").lower()
            name=(el.get_attribute("name") or "").lower()
            ph=(el.get_attribute("placeholder") or "").lower()
            aria=(el.get_attribute("aria-label") or "").lower()
            key=" ".join([name,ph,aria])
            score=0
            if kind=="password":
                if typ=="password": score+=20
                if "senha" in key or "password" in key: score+=10
            elif kind=="username":
                if typ in ("text","email","tel",""): score+=3
                for w in ("usuario","usuário","username","login","email","e-mail"):
                    if w in key: score+=8
                if typ=="password": score=-100
            elif kind=="search":
                if typ in ("text","search",""): score+=2
                for w in ("buscar","pesquisar","search","usuario","usuário","username","cliente"):
                    if w in key: score+=6
                if typ=="password": score=-100
            elif kind=="name":
                if typ in ("text",""): score+=2
                for w in ("nome","name","cliente","observacao","observação"):
                    if w in key: score+=6
                if typ=="password": score=-100
            if score>best_score:
                best_score=score;best=el
        except Exception:
            continue
    return best if best_score>0 else None

def _click_by_text(page, patterns, scope=None):
    root=scope or page
    try:
        loc=root.locator("button,a,[role=button],li")
        n=min(loc.count(),250)
    except Exception:
        n=0
    pats=[_norm_text(x) for x in patterns]
    for i in range(n):
        el=loc.nth(i)
        try:
            if not el.is_visible(): continue
            txt=_norm_text(el.inner_text(timeout=800))
            if not txt: continue
            if any(p in txt for p in pats):
                el.click(timeout=3000)
                return True
        except Exception:
            continue
    return False

def _wait_after_action(page, ms=1800):
    try:
        page.wait_for_load_state("domcontentloaded",timeout=5000)
    except Exception:
        pass
    try:
        page.wait_for_timeout(ms)
    except Exception:
        pass

def _looks_logged_in(page):
    url=(page.url or "").lower()
    body=_norm_text(_body_text(page))
    pw=_first_visible(page.locator("input[type=password]"))
    if pw is not None and any(x in body for x in ("entrar","login","sign in","acessar")):
        return False
    if any(x in url for x in ("/dashboard","#/dashboard","/customers","#/customers","/clientes","#/clientes")):
        return True
    return any(x in body for x in ("dashboard","clientes","subrevendas","teste rapido","teste rápido","saldo","creditos","créditos")) and pw is None

def _login_panel(page,context,panel,creds):
    base=str(panel.get("base_url") or "").strip()
    if not base: raise RuntimeError("panel_url_missing")
    try:
        page.goto(base,wait_until="domcontentloaded",timeout=25000)
    except Exception:
        try: page.goto(base,wait_until="commit",timeout=25000)
        except Exception as e: raise RuntimeError("panel_unreachable: "+str(e)[:180])

    # Give Cloudflare/browser checks a little time without bypassing a CAPTCHA.
    body=_norm_text(_body_text(page))
    if "404 not found" in body or body=="404 not found nginx":
        raise RuntimeError("panel_url_404")
    if "just a moment" in body or "verificando" in body or "checking your browser" in body:
        page.wait_for_timeout(7000)

    if _looks_logged_in(page):
        try: context.storage_state(path=panel_session_path(panel.get("id")))
        except Exception: pass
        return True

    user=_find_input(page,"username")
    pwd=_find_input(page,"password")
    if user is None or pwd is None:
        try:
            diag_inputs=[]
            inputs=page.locator("input")
            for i in range(min(inputs.count(),20)):
                el=inputs.nth(i)
                if not el.is_visible(): continue
                diag_inputs.append({
                    "type":el.get_attribute("type") or "",
                    "name":el.get_attribute("name") or "",
                    "placeholder":el.get_attribute("placeholder") or "",
                    "aria":el.get_attribute("aria-label") or ""
                })
            print("PANEL_LOGIN_FIELDS_MISSING",json.dumps({
                "panel":str(panel.get("name") or ""),
                "url":str(page.url or ""),
                "inputs":diag_inputs,
                "body":_norm_text(_body_text(page))[:1600]
            },ensure_ascii=False),flush=True)
            try:
                page.screenshot(path="/tmp/panel-login-"+str(panel.get("id") or "unknown")+".png",full_page=True)
            except Exception:
                pass
        except Exception as e:
            print("PANEL_LOGIN_DIAG_ERROR",type(e).__name__,str(e)[:200],flush=True)
        return False
    username=str((creds or {}).get("username") or "")
    password=str((creds or {}).get("password") or "")
    if not username or not password: raise RuntimeError("credentials_missing")
    user.fill(username)
    pwd.fill(password)
    submit=_first_visible(page.locator("button[type=submit],input[type=submit]"))
    if submit is not None:
        submit.click(timeout=4000)
    elif not _click_by_text(page,["entrar","acessar","login","sign in"]):
        try: pwd.press("Enter")
        except Exception: pass
    _wait_after_action(page,2600)
    ok=_looks_logged_in(page)
    if not ok:
        try:
            diag_inputs=[]
            inputs=page.locator("input")
            for i in range(min(inputs.count(),20)):
                el=inputs.nth(i)
                if not el.is_visible(): continue
                diag_inputs.append({
                    "type":el.get_attribute("type") or "",
                    "name":el.get_attribute("name") or "",
                    "placeholder":el.get_attribute("placeholder") or "",
                    "aria":el.get_attribute("aria-label") or ""
                })
            diag_body=_norm_text(_body_text(page))[:1200]
            print("PANEL_LOGIN_DIAG",json.dumps({
                "panel":str(panel.get("name") or ""),
                "url":str(page.url or ""),
                "inputs":diag_inputs,
                "body":diag_body
            },ensure_ascii=False),flush=True)
            try:
                page.screenshot(path="/tmp/panel-login-"+str(panel.get("id") or "unknown")+".png",full_page=True)
            except Exception:
                pass
        except Exception as e:
            print("PANEL_LOGIN_DIAG_ERROR",type(e).__name__,str(e)[:200],flush=True)
    if ok:
        try: context.storage_state(path=panel_session_path(panel.get("id")))
        except Exception: pass
    return ok

def _parse_expiry(text):
    s=str(text or "")
    m=re.search(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?",s)
    if not m: return None
    try:
        dt=datetime(int(m.group(3)),int(m.group(2)),int(m.group(1)),int(m.group(4) or 23),int(m.group(5) or 59),tzinfo=timezone(timedelta(hours=-3)))
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        return None

def _parse_access(text, fallback_username=""):
    s=str(text or "")
    out={}
    pats={
      "username":r"(?:usuario|usuário|username|login)\s*[:=-]\s*([A-Za-z0-9._@-]{3,80})",
      "password":r"(?:senha|password|pass)\s*[:=-]\s*([^\s,;]{3,120})",
      "dns":r"(?:dns)\s*[:=-]\s*(https?://[^\s]+|[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?::\d+)?)",
      "code":r"(?:codigo|código|code)\s*[:=-]\s*([A-Za-z0-9._-]{3,120})"
    }
    for k,p in pats.items():
        m=re.search(p,s,re.I)
        if m: out[k]=m.group(1).strip().rstrip(".,;")
    urls=re.findall(r"https?://[^\s<>'\"]+",s,re.I)
    if urls:
        m3u=next((u for u in urls if "get.php" in u or "m3u" in u.lower()),None)
        if m3u: out["m3u"]=m3u.rstrip(".,;")
        else: out["url"]=urls[0].rstrip(".,;")
    if fallback_username and not out.get("username"): out["username"]=fallback_username
    sc=re.search(r"\b(\d+)\s*(?:tela|telas|conexao|conexões|conexoes)\b",_norm_text(s))
    if sc:
        try: out["screen_count"]=max(1,min(10,int(sc.group(1))))
        except Exception: pass
    exp=_parse_expiry(s)
    if exp: out["expires_at"]=exp
    low=_norm_text(s)
    if any(x in low for x in ("vencido","inativo","expired")): out["status"]="expired"
    elif any(x in low for x in ("ativo","active")): out["status"]="active"
    return out

def _open_clients(page):
    if any(x in (page.url or "").lower() for x in ("customers","clientes")): return True
    if _click_by_text(page,["clientes","customers","usuarios","usuários"]):
        _wait_after_action(page,1200)
        return True
    return False

def _find_user_row(page,username):
    un=_norm_text(username)
    try:
        for selector in ("tr","[role=row]",".MuiDataGrid-row",".v-data-table__tr",".table-row"):
            loc=page.locator(selector)
            n=min(loc.count(),500)
            for i in range(n):
                row=loc.nth(i)
                try:
                    if not row.is_visible(): continue
                    txt=row.inner_text(timeout=700)
                    if un and un in _norm_text(txt): return row,txt
                except Exception:
                    continue
    except Exception:
        pass
    body=_body_text(page)
    if un in _norm_text(body): return None,body
    return None,""


def _detect_panel_apps(page,known_apps):
    apps=known_apps if isinstance(known_apps,list) else []

    def scan_text_and_options():
        body=_norm_text(_body_text(page))
        option_rows=[]
        try:
            opts=page.locator("option")
            for i in range(min(opts.count(),400)):
                o=opts.nth(i)
                try:
                    txt=(o.inner_text(timeout=500) or "").strip()
                    val=(o.get_attribute("value") or "").strip()
                    if txt: option_rows.append((txt,val))
                except Exception:
                    pass
        except Exception:
            pass

        found=[]
        seen_names=set()
        seen_ids=set()

        # Primeiro cruza com o catálogo conhecido desta conta.
        for app in apps:
            aid=str(app.get("id") or "")
            name=str(app.get("name") or "").strip()
            aliases=app.get("aliases") or []
            names=[name]+[str(x) for x in aliases if str(x).strip()]
            hit=False; code=""
            for txt,val in option_rows:
                nt=_norm_text(txt)
                if any(_norm_text(n) and _norm_text(n) in nt for n in names):
                    hit=True
                    code=val or txt
                    break
            if not hit:
                hit=any(_norm_text(n) and _norm_text(n) in body for n in names)
            if hit and name:
                key=_norm_text(name)
                if aid and aid not in seen_ids:
                    seen_ids.add(aid)
                    seen_names.add(key)
                    found.append({"app_catalog_id":aid,"app_name":name,"panel_app_code":code or name})
                elif not aid and key not in seen_names:
                    seen_names.add(key)
                    found.append({"app_catalog_id":None,"app_name":name,"panel_app_code":code or name})

        # Depois guarda opções de aplicativo que o próprio painel mostrar,
        # mesmo quando ainda não existem no catálogo local.
        ignored={
            "selecione","selecionar","escolha","todos","nenhum","nenhuma","1 tela","2 telas",
            "3 telas","4 telas","5 telas","30 dias","90 dias","180 dias","365 dias",
            "mensal","trimestral","semestral","anual"
        }
        app_words=("player","play","iptv","tv","app","smarters","ibo","xciptv","smart","box","flix","stream")
        for txt,val in option_rows:
            clean=" ".join(str(txt or "").split()).strip()
            nt=_norm_text(clean)
            if not clean or len(clean)>90 or nt in ignored: continue
            if nt in seen_names: continue
            if not any(w in nt for w in app_words): continue
            seen_names.add(nt)
            found.append({"app_catalog_id":None,"app_name":clean,"panel_app_code":val or clean})

        return found

    found=scan_text_and_options()
    if found: return found

    # Procura telas onde os servidores costumam listar parceiros/aplicativos.
    for labels in (
        ["aplicativos parceiros","apps parceiros","aplicativos","apps"],
        ["teste rapido","teste rápido","novo teste","criar teste"]
    ):
        if _click_by_text(page,labels):
            _wait_after_action(page,900)
            found=scan_text_and_options()
            if found:return found
    return []

def _panel_search_user(page,username):
    _open_clients(page)
    search=_find_input(page,"search")
    if search is not None:
        try:
            search.fill(username)
            try: search.press("Enter")
            except Exception: pass
            _wait_after_action(page,1000)
        except Exception:
            pass
    row,text=_find_user_row(page,username)
    if not text:
        return {"found":False,"username":username}
    data=_parse_access(text,username)
    # Read playlist/access data when there is an explicit safe action.
    if row is not None:
        if _click_by_text(page,["playlist","dados de acesso","acesso","m3u"],scope=row):
            _wait_after_action(page,900)
            extra=_parse_access(_body_text(page),username)
            data.update({k:v for k,v in extra.items() if v})
    return {"found":True,**data}

def _panel_generate_test(page,job):
    screens=int(job.get("screen_count") or 1)
    panel=job.get("panel") or {}
    provider_type=str(panel.get("provider_type") or "").strip().lower()
    code=str(job.get("panel_app_code") or "").strip()
    app_name=str(job.get("app_name") or "").strip()

    partner_apps=[]
    if provider_type!="cs":
        partner_apps=_detect_panel_apps(page,job.get("known_apps") or [])

    selected=False
    if provider_type=="cs":
        selected=_click_by_text(page,[
            "teste rapido","teste rápido","novo teste","criar teste",
            "gerar teste","teste","adicionar teste","new test"
        ])
        if not selected:
            _open_clients(page)
            _wait_after_action(page,500)
            selected=_click_by_text(page,[
                "teste rapido","teste rápido","novo teste","criar teste",
                "gerar teste","teste","adicionar teste","new test"
            ])
        if not selected:
            raise RuntimeError("cs_test_action_not_found")
    else:
        if not code:
            raise RuntimeError("panel_app_code_required")
        try:
            selects=page.locator("select")
            for i in range(min(selects.count(),20)):
                sel=selects.nth(i)
                try:
                    if code:
                        sel.select_option(value=code)
                        selected=True
                        break
                except Exception:
                    pass
                if app_name:
                    try:
                        sel.select_option(label=app_name)
                        selected=True
                        break
                    except Exception:
                        pass
        except Exception:
            pass
        if not selected:
            labels=[x for x in (code,app_name) if x]
            selected=_click_by_text(page,labels)
        if not selected:
            raise RuntimeError("test_profile_not_found: "+(app_name or code)[:80])

    _wait_after_action(page,900)

    name=str(job.get("customer_name") or job.get("customer_phone") or "Teste WhatsApp").strip()
    name_input=_find_input(page,"name")
    if name_input is not None:
        try:
            if not name_input.input_value(): name_input.fill(name[:80])
        except Exception:
            pass

    # Confirm only recognized create/generate actions.
    if _click_by_text(page,["gerar teste","criar teste","confirmar","gerar","criar"]):
        _wait_after_action(page,1800)

    result=_parse_access(_body_text(page))
    username=result.get("username")
    if not username:
        raise RuntimeError("test_created_but_credentials_not_detected")

    # Add only the exact number of extra screens requested, and only through an explicit action.
    if screens>1:
        for _ in range(screens-1):
            if not _click_by_text(page,["adicionar tela","adicionar conexão","adicionar conexao","add screen"]):
                raise RuntimeError("extra_screen_action_not_found")
            _wait_after_action(page,700)
            _click_by_text(page,["confirmar","adicionar","salvar"])
            _wait_after_action(page,700)
    if not partner_apps:
        try:
            partner_apps=_detect_panel_apps(page,job.get("known_apps") or [])
        except Exception:
            partner_apps=[]
    result["partner_apps"]=partner_apps
    result["screen_count"]=screens
    result["created"]=True
    if not result.get("status"): result["status"]="active"
    return result

def _panel_create_user(page,job):
    payload=job.get("payload") or {}
    phone=re.sub(r"\D+","",str(job.get("customer_phone") or payload.get("phone") or ""))
    name=str(job.get("customer_name") or payload.get("customer_name") or phone or "Cliente WhatsApp").strip()[:80]
    username=str(payload.get("username") or job.get("requested_username") or "").strip()
    if not username:
        suffix=(phone[-6:] if len(phone)>=6 else hashlib.sha1((name+str(time.time())).encode()).hexdigest()[:6])
        username="cli"+suffix
    password=str(payload.get("password") or "").strip()
    if not password:
        seed=hashlib.sha256((username+str(time.time_ns())).encode()).hexdigest()
        password="Js"+seed[:8]+"!"

    _open_clients(page)
    if not _click_by_text(page,[
        "novo cliente","novo usuario","novo usuário","adicionar cliente",
        "adicionar usuario","adicionar usuário","criar cliente","criar usuario",
        "criar usuário","create user","new user","add customer","add user"
    ]):
        raise RuntimeError("create_user_action_not_found")
    _wait_after_action(page,900)

    name_input=_find_input(page,"name")
    if name_input is not None:
        try:name_input.fill(name)
        except Exception:pass

    user_input=_find_input(page,"username")
    if user_input is not None:
        try:user_input.fill(username)
        except Exception:pass

    pass_input=_find_input(page,"password")
    if pass_input is not None:
        try:pass_input.fill(password)
        except Exception:pass

    code=str(job.get("panel_app_code") or payload.get("panel_app_code") or "").strip()
    app_name=str(job.get("app_name") or payload.get("app_name") or "").strip()
    if code or app_name:
        selected=False
        try:
            selects=page.locator("select")
            for i in range(min(selects.count(),25)):
                sel=selects.nth(i)
                if not sel.is_visible(): continue
                if code:
                    try:
                        sel.select_option(value=code);selected=True;break
                    except Exception:pass
                if app_name:
                    try:
                        sel.select_option(label=app_name);selected=True;break
                    except Exception:pass
        except Exception:pass
        if not selected:
            _click_by_text(page,[x for x in (code,app_name) if x])

    days=int(job.get("plan_days") or payload.get("plan_days") or 30)
    labels={30:["30 dias","1 mes","1 mês","mensal"],90:["90 dias","3 meses","trimestral"],180:["180 dias","6 meses","semestral"],365:["365 dias","12 meses","anual"]}.get(days,[str(days)])
    period_selected=_click_by_text(page,labels)
    if not period_selected:
        try:
            selects=page.locator("select")
            for i in range(min(selects.count(),25)):
                sel=selects.nth(i)
                if not sel.is_visible(): continue
                for label in labels:
                    try:
                        sel.select_option(label=label);period_selected=True;break
                    except Exception:pass
                if period_selected:break
        except Exception:pass

    screens=max(1,min(10,int(job.get("screen_count") or payload.get("screen_count") or 1)))
    screen_field=None
    try:
        screen_field=_find_device_field(page,["telas","tela","screens","screen","conexoes","conexões","connections"])
    except Exception:
        screen_field=None
    if screen_field is not None:
        try:screen_field.fill(str(screens))
        except Exception:pass
    else:
        _click_by_text(page,[str(screens)+" telas",str(screens)+" tela",str(screens)+" screens"])

    if not _click_by_text(page,["salvar","criar","adicionar","confirmar","ativar","create","save"]):
        submit=_first_visible(page.locator("button[type=submit],input[type=submit]"))
        if submit is None:
            raise RuntimeError("create_user_submit_not_found")
        submit.click(timeout=4000)
    _wait_after_action(page,1700)

    result=_parse_access(_body_text(page),username)
    result["username"]=result.get("username") or username
    if not result.get("password") and pass_input is not None:
        result["password"]=password
    result["screen_count"]=screens
    result["plan_days"]=days
    result["created"]=True
    result["activated"]=True
    if not result.get("status"):result["status"]="active"
    return result

def _panel_renew_user(page,job):
    username=str((job.get("payload") or {}).get("username") or "").strip()
    if not username: raise RuntimeError("username_required")
    _open_clients(page)
    search=_find_input(page,"search")
    if search is not None:
        try: search.fill(username); search.press("Enter")
        except Exception: pass
        _wait_after_action(page,900)
    row,text=_find_user_row(page,username)
    if not text: return {"found":False,"username":username}
    if row is None or not _click_by_text(page,["renovar","renew"],scope=row):
        raise RuntimeError("renew_action_not_found")
    _wait_after_action(page,700)
    days=int(job.get("plan_days") or 30)
    labels={30:["30 dias","1 mes","1 mês","mensal"],90:["90 dias","3 meses","trimestral"],180:["180 dias","6 meses","semestral"],365:["365 dias","12 meses","anual"]}.get(days,[str(days)])
    if not _click_by_text(page,labels):
        # Select option by visible text when a select is used.
        sel=_first_visible(page.locator("select"))
        if sel is not None:
            picked=False
            for label in labels:
                try:
                    sel.select_option(label=label)
                    picked=True;break
                except Exception: pass
            if not picked: raise RuntimeError("renew_period_not_found")
        else:
            raise RuntimeError("renew_period_not_found")
    _click_by_text(page,["confirmar","renovar","salvar"])
    _wait_after_action(page,1500)
    refreshed=_panel_search_user(page,username)
    refreshed["activated"]=bool(refreshed.get("found"))
    return refreshed

def _render_activation_template(value, variables):
    if isinstance(value, dict):
        return {k:_render_activation_template(v,variables) for k,v in value.items()}
    if isinstance(value, list):
        return [_render_activation_template(v,variables) for v in value]
    if isinstance(value, str):
        out=value
        for k,v in variables.items():
            out=out.replace("{{"+k+"}}",str(v or ""))
        return out
    return value

def _find_device_field(page, terms):
    terms=[_norm_text(x) for x in terms]
    loc=page.locator("input,textarea")
    best=None; best_score=0
    try:
        n=min(loc.count(),80)
    except Exception:
        n=0
    for i in range(n):
        el=loc.nth(i)
        try:
            if not el.is_visible(): continue
            typ=(el.get_attribute("type") or "text").lower()
            if typ in ("hidden","password","submit","button","checkbox","radio"): continue
            attrs=" ".join([
                el.get_attribute("name") or "",
                el.get_attribute("id") or "",
                el.get_attribute("placeholder") or "",
                el.get_attribute("aria-label") or ""
            ])
            hay=_norm_text(attrs)
            score=sum(10 for t in terms if t and t in hay)
            if score>best_score:
                best_score=score;best=el
        except Exception:
            pass
    return best if best_score>0 else None

def _panel_activate_app(page,job):
    payload=job.get("payload") or {}
    mac=str(payload.get("mac") or payload.get("mac_address") or "").strip()
    device_key=str(payload.get("device_key") or payload.get("key") or "").strip()
    app_name=str(job.get("app_name") or payload.get("app_name") or "").strip()
    code=str(job.get("panel_app_code") or payload.get("panel_app_code") or "").strip()
    playlist=str(payload.get("playlist_url") or payload.get("m3u") or payload.get("url") or "").strip()

    if not mac and not device_key:
        raise RuntimeError("mac_or_key_required")

    if app_name or code:
        selected=_click_by_text(page,[x for x in (app_name,code) if x])
        if not selected:
            _click_by_text(page,[
                "aplicativos parceiros","apps parceiros","aplicativos","apps",
                "ativacao","ativação","ativar aplicativo","player"
            ])
            _wait_after_action(page,700)
            _click_by_text(page,[x for x in (app_name,code) if x])
        _wait_after_action(page,500)

    mac_field=_find_device_field(page,["mac address","mac","endereco mac","endereço mac"])
    key_field=_find_device_field(page,["device key","devicekey","key","chave","device code","codigo","código"])

    if mac_field is None and key_field is None:
        _click_by_text(page,[
            "aplicativos parceiros","apps parceiros","aplicativos","apps",
            "ativacao","ativação","ativar aplicativo","player"
        ])
        _wait_after_action(page,600)
        if app_name or code:
            _click_by_text(page,[x for x in (app_name,code) if x])
            _wait_after_action(page,500)
        mac_field=_find_device_field(page,["mac address","mac","endereco mac","endereço mac"])
        key_field=_find_device_field(page,["device key","devicekey","key","chave","device code","codigo","código"])
    if mac and mac_field is not None:
        mac_field.fill(mac)
    if device_key and key_field is not None:
        key_field.fill(device_key)

    if playlist:
        list_field=_find_device_field(page,["playlist","m3u","url","lista","server url","portal"])
        if list_field is not None:
            try:list_field.fill(playlist)
            except Exception:pass

    if (mac and mac_field is None) and (device_key and key_field is None):
        raise RuntimeError("activation_fields_not_found")

    if not _click_by_text(page,["ativar","activate","salvar","save","adicionar","confirmar"]):
        submit=_first_visible(page.locator("button[type=submit],input[type=submit]"))
        if submit is None:
            raise RuntimeError("activate_app_submit_not_found")
        submit.click(timeout=4000)
    _wait_after_action(page,1600)

    body=_norm_text(_body_text(page))
    if any(x in body for x in ("falha","erro","invalid mac","mac invalido","mac inválido","invalid key","chave invalida","chave inválida")):
        raise RuntimeError("activate_app_rejected")
    return {
        "activated":True,
        "status":"active",
        "app_name":app_name or None,
        "mac":mac or None,
        "device_key":device_key or None
    }

def _configure_device(job):
    app=job.get("app_activation") or {}
    creds=job.get("activation_credentials") or {}
    payload=job.get("payload") or {}
    mac=str(payload.get("mac") or payload.get("mac_address") or "").strip()
    device_key=str(payload.get("device_key") or payload.get("key") or "").strip()
    playlist=str(payload.get("playlist_url") or payload.get("m3u") or payload.get("url") or "").strip()
    if not mac or not device_key:
        raise RuntimeError("mac_and_key_required")

    driver=str(app.get("activation_driver") or "").strip().lower()
    target=str(app.get("activation_url") or "").strip()
    if not target:
        raise RuntimeError("activation_url_missing")

    variables={
        "mac":mac,
        "key":device_key,
        "device_key":device_key,
        "playlist_url":playlist,
        "m3u":playlist,
        "url":playlist,
        "username":str(creds.get("username") or ""),
        "password":str(creds.get("password") or ""),
        "api_key":str(creds.get("api_key") or ""),
        "customer_name":str(job.get("customer_name") or ""),
        "customer_phone":str(job.get("customer_phone") or "")
    }

    if driver=="api":
        method=str(app.get("activation_method") or "POST").upper()
        body=_render_activation_template(app.get("activation_payload_template") or {"mac":"{{mac}}","key":"{{key}}"},variables)
        headers={"Accept":"application/json"}
        api_key=str(creds.get("api_key") or "").strip()
        if api_key:
            header=str(app.get("activation_api_key_header") or "Authorization").strip() or "Authorization"
            prefix=str(app.get("activation_api_key_prefix") if app.get("activation_api_key_prefix") is not None else "Bearer ")
            headers[header]=prefix+api_key
        username=str(creds.get("username") or "")
        password=str(creds.get("password") or "")
        if username and password and "Authorization" not in headers:
            basic=base64.b64encode((username+":"+password).encode("utf-8")).decode("ascii")
            headers["Authorization"]="Basic "+basic
        result=http_json(target,method,body,headers,timeout=30)
        if isinstance(result,dict):
            if result.get("success") is False or result.get("ok") is False:
                raise RuntimeError("activation_api_rejected: "+json.dumps(result,ensure_ascii=False)[:300])
            msg=str(result.get("message") or result.get("customer_message") or "").strip()
            return {"configured":True,"driver":"api","app_name":app.get("name"),"response":result,"customer_message":msg}
        return {"configured":True,"driver":"api","app_name":app.get("name")}

    if driver!="rpa":
        raise RuntimeError("activation_driver_not_supported")

    if not HAS_PLAYWRIGHT:
        raise RuntimeError("playwright_not_installed")

    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,args=["--no-sandbox","--disable-dev-shm-usage","--disable-gpu","--disable-blink-features=AutomationControlled"])
        try:
            context=browser.new_context(viewport={"width":1365,"height":900},locale="pt-BR")
            page=context.new_page()
            page.goto(target,wait_until="domcontentloaded",timeout=30000)
            page.wait_for_timeout(1200)

            username=str(creds.get("username") or "").strip()
            password=str(creds.get("password") or "")
            if username and password:
                user=_find_input(page,"username")
                pwd=_find_input(page,"password")
                if user is not None and pwd is not None:
                    user.fill(username); pwd.fill(password)
                    submit=_first_visible(page.locator("button[type=submit],input[type=submit]"))
                    if submit is not None: submit.click(timeout=4000)
                    else: _click_by_text(page,["entrar","acessar","login","sign in"])
                    _wait_after_action(page,1800)

            mac_field=_find_device_field(page,["mac address","mac","endereco mac","endereço mac"])
            key_field=_find_device_field(page,["device key","devicekey","key","chave","device code"])
            if mac_field is None or key_field is None:
                raise RuntimeError("mac_key_fields_not_found")
            mac_field.fill(mac)
            key_field.fill(device_key)

            if playlist:
                list_field=_find_device_field(page,["playlist","m3u","url","lista","server url","portal"])
                if list_field is not None:
                    try:list_field.fill(playlist)
                    except Exception:pass

            if not _click_by_text(page,["adicionar","add playlist","salvar","save","ativar","activate","confirmar","enviar","submit"]):
                submit=_first_visible(page.locator("button[type=submit],input[type=submit]"))
                if submit is None:
                    raise RuntimeError("activation_submit_not_found")
                submit.click(timeout=4000)

            _wait_after_action(page,2200)
            body=_norm_text(_body_text(page))
            if any(x in body for x in ("invalid mac","mac invalido","mac inválido","invalid key","chave invalida","chave inválida","activation failed","falha na ativacao","falha na ativação")):
                raise RuntimeError("activation_rpa_rejected")
            return {"configured":True,"driver":"rpa","app_name":app.get("name")}
        finally:
            try:browser.close()
            except Exception:pass

def run_panel_job(job):
    action=str(job.get("action_type") or "")
    if action=="configure_device":
        return _configure_device(job)
    if not HAS_PLAYWRIGHT:
        raise RuntimeError("playwright_not_installed")
    panel=job.get("panel") or {}
    creds=job.get("credentials") or {}
    action=str(job.get("action_type") or "")
    state_path=panel_session_path(panel.get("id"))
    with sync_playwright() as p:
        args=["--no-sandbox","--disable-dev-shm-usage","--disable-gpu","--no-first-run","--disable-background-networking","--disable-blink-features=AutomationControlled"]
        browser=p.chromium.launch(headless=True,args=args)
        try:
            context_args={"viewport":{"width":1365,"height":900},"locale":"pt-BR"}
            if os.path.exists(state_path):
                context_args["storage_state"]=state_path
            context=browser.new_context(**context_args)
            page=context.new_page()
            ok=_login_panel(page,context,panel,creds)
            if not ok:
                raise RuntimeError("login_not_validated")
            if action=="probe_login":
                detected=_detect_panel_apps(page,job.get("known_apps") or [])
                return {"authenticated":True,"status":"connected","detected_apps":detected}
            if action=="scan_apps":
                detected=_detect_panel_apps(page,job.get("known_apps") or [])
                return {"authenticated":True,"status":"connected","detected_apps":detected,"partner_apps":detected}
            if action in ("search_user","refresh_access","check_codes"):
                username=str((job.get("payload") or {}).get("username") or "").strip()
                if not username: raise RuntimeError("username_required")
                return _panel_search_user(page,username)
            if action=="test":
                return _panel_generate_test(page,job)
            if action=="create_user":
                return _panel_create_user(page,job)
            if action=="activate_app":
                return _panel_activate_app(page,job)
            if action in ("renew","activate"):
                return _panel_renew_user(page,job)
            raise RuntimeError("panel_action_not_supported: "+action)
        finally:
            try: browser.close()
            except Exception: pass

def ack_panel_job(job_id,ok,result=None,error=None):
    payload={"job_id":job_id,"ok":bool(ok),"result":result or {}}
    if error: payload["error"]=str(error)[:1500]
    try: cloud("ack_panel_job",**payload)
    except Exception: pass

def process_panel_job(job):
    jid=str(job.get("id",""))
    if not jid: return
    try:
        result=run_panel_job(job)
        ack_panel_job(jid,True,result=result)
    except Exception as e:
        ack_panel_job(jid,False,error=e)

def _extract_download_data(result):
    cur=result
    for _ in range(5):
        if isinstance(cur,dict):
            for key in ("Data","data","base64","Base64"):
                if key in cur and cur[key] not in (None,""):
                    cur=cur[key]
                    break
            else:
                return "", ""
        elif isinstance(cur,str):
            s=cur.strip()
            if s.startswith("{") or s.startswith("["):
                try:
                    cur=json.loads(s)
                    continue
                except Exception:
                    pass
            if s.startswith("data:") and "," in s:
                head,b64=s.split(",",1)
                mt=head[5:].split(";",1)[0] if head.startswith("data:") else ""
                return b64,mt
            return s,""
        else:
            return "",""
    return "",""

def _ocr_image_base64(b64data):
    """Extrai texto visível da imagem localmente para o atendimento não depender da IA visual."""
    path=""
    try:
        raw=base64.b64decode(str(b64data),validate=False)
        if not raw:
            return ""
        with tempfile.NamedTemporaryFile(prefix="jstech-ocr-",suffix=".img",delete=False) as f:
            f.write(raw)
            path=f.name
        proc=subprocess.run(
            ["tesseract",path,"stdout","-l","por+eng","--psm","6"],
            stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,timeout=20,check=False
        )
        text=re.sub(r"\s+"," ",(proc.stdout or "")).strip()
        return text[:4000]
    except Exception as e:
        print("OCR falhou:",str(e)[:200],flush=True)
        return ""
    finally:
        if path:
            try: os.unlink(path)
            except Exception: pass

def download_media_and_reinject(payload, token=None):
    p=payload or {}
    kind=str(p.get("kind","")).lower().strip()
    endpoint={
        "image":"/chat/downloadimage",
        "audio":"/chat/downloadaudio",
        "document":"/chat/downloaddocument",
        "video":"/chat/downloadvideo",
    }.get(kind)
    if not endpoint:
        raise RuntimeError("tipo de midia nao suportado")
    body=p.get("download_body") or {}
    result=wuz(endpoint,body,token)
    b64,detected_mime=_extract_download_data(result)
    if not b64:
        raise RuntimeError("midia baixada sem dados")
    mime=detected_mime or str(p.get("mime") or body.get("Mimetype") or "")
    if kind=="audio" and str(mime).lower().split(";",1)[0] in ("application/ogg","application/octet-stream"):
        mime="audio/ogg"
    msg_key={"image":"imageMessage","audio":"audioMessage","document":"documentMessage","video":"videoMessage"}[kind]
    info={
        "Chat":str(p.get("chat") or ""),
        "Sender":str(p.get("sender") or ""),
        "Recipient":str(p.get("recipient") or p.get("chat") or ""),
        "ID":str(p.get("external_message_id") or ""),
        "PushName":str(p.get("profile_name") or ""),
        "IsFromMe":bool(p.get("from_me") or p.get("owner_voice_sample")),
        "IsGroup":False,
    }
    message={msg_key:{"mimetype":mime}}
    caption=str(p.get("caption") or "").strip()
    if caption and kind in ("image","video","document"):
        message[msg_key]["caption"]=caption
    ocr_text=_ocr_image_base64(b64) if kind=="image" else ""
    event={
        "type":"Message",
        "data":{"Info":info,"Message":message},
        "base64":b64,
        "ocrText":ocr_text,
        "mimeType":mime,
        "fileName":str(p.get("file_name") or ""),
    }
    headers={"token":token or TOKEN,"Content-Type":"application/json"}
    return http_json("https://fvttsguxeocisqvcrbqh.supabase.co/functions/v1/jstech-wa-wuzapi-webhook","POST",event,headers,40)

def local_status_snapshot(ensure_connect=False):
    initial={}
    try:
        st0=wuz_get("/session/status",TOKEN)
        initial=st0.get("data",{}) if isinstance(st0,dict) else {}
    except Exception:
        initial={}

    logged0=bool(initial.get("loggedIn") or initial.get("LoggedIn"))
    wire0=bool(initial.get("connected") if "connected" in initial else initial.get("Connected",logged0))

    if ensure_connect and not (logged0 and wire0):
        try:
            wuz("/session/connect",{"Subscribe":["All"],"Immediate":True},TOKEN)
        except Exception:
            pass

    tries=8 if ensure_connect else 1
    last_result=None
    for _ in range(tries):
        if ensure_connect:
            time.sleep(.8)

        st=wuz_get("/session/status",TOKEN)
        d=st.get("data",{}) if isinstance(st,dict) else {}
        logged=bool(d.get("loggedIn") or d.get("LoggedIn"))
        wire=bool(d.get("connected") if "connected" in d else d.get("Connected",logged))
        connected=bool(logged and wire)

        result={
            "connected":connected,
            "ready":True,
            "status":"connected" if connected else ("reconnecting" if logged else "waiting_qr"),
            "qr_code":None,
            "qr_expires_at":None,
        }
        jid=str(d.get("jid") or d.get("JID") or "").strip()
        name=str(d.get("name") or d.get("Name") or "").strip()
        external_user_id=str(d.get("id") or d.get("ID") or "").strip()
        if jid: result["jid"]=jid
        if name: result["name"]=name
        if external_user_id: result["external_user_id"]=external_user_id

        if connected:
            return result

        if logged:
            if ensure_connect:
                try:
                    wuz("/session/connect",{"Subscribe":["All"],"Immediate":True},TOKEN)
                except Exception:
                    pass
            last_result=result
            continue

        try:
            q=wuz_get("/session/qr",TOKEN)
            qd=q.get("data",{}) if isinstance(q,dict) else {}
            qr=qd.get("QRCode") or qd.get("qrcode")
            if isinstance(qr,str) and qr.startswith("data:image"):
                result["qr_code"]=qr
                result["qr_expires_at"]=(datetime.now(timezone.utc)+timedelta(seconds=70)).isoformat()
                return result
        except Exception:
            pass

        last_result=result

    return last_result or {
        "connected":False,
        "ready":True,
        "status":"offline",
        "qr_code":None,
        "qr_expires_at":None,
    }

def process_local_command(cmd):
    cid=str(cmd.get("id",""))
    action=str(cmd.get("action",""))
    try:
        if action=="reject_call":
            p=cmd.get("payload") or {}
            call_from=str(p.get("call_from","")).strip()
            call_id=str(p.get("call_id","")).strip()
            if not call_from or not call_id:
                raise RuntimeError("dados da ligação incompletos")
            reject_call(call_from,call_id)
            ack_command(cid,True,result={"rejected":True,"call_id":call_id})
        elif action=="download_media":
            result=download_media_and_reinject(cmd.get("payload") or {},TOKEN)
            ack_command(cid,True,result={"downloaded":True,"webhook":result})
        elif action=="sync_contacts":
            result=fetch_contacts(TOKEN)
            ack_command(cid,True,result=result)
        elif action=="typing":
            p=cmd.get("payload") or {}
            phone=str(p.get("phone") or "").strip()
            if not phone:
                raise RuntimeError("telefone ausente para digitando")
            seconds=max(1,min(int(p.get("seconds") or 12),12))
            presence(phone,"composing")
            timer=threading.Timer(seconds,lambda: presence(phone,"paused"))
            timer.daemon=True
            timer.start()
            ack_command(cid,True,result={"typing":True,"phone":phone,"seconds":seconds})
        elif action=="connect":
            result=local_status_snapshot(True)
            ack_command(cid,True,result=result)
        elif action=="status":
            result=local_status_snapshot(False)
            ack_command(cid,True,result=result)
        elif action=="logout":
            try:
                wuz("/session/logout",{},TOKEN)
            except Exception:
                pass
            ack_command(cid,True,result={
                "connected":False,
                "ready":True,
                "status":"logged_out",
                "qr_code":None,
                "qr_expires_at":None,
            })
        else:
            raise RuntimeError("ação desconhecida: "+action)
    except Exception as e:
        ack_command(cid,False,error=e)

def main():
    try: cloud("recover")
    except Exception: pass
    last_hb=0
    last_hook=0
    while True:
        try:
            now=time.time()
            if now-last_hook>60:
                try:
                    ensure_local_webhook()
                except Exception:
                    pass
                last_hook=now
            if now-last_hb>25:
                try:
                    cloud("heartbeat",**local_status_snapshot(True))
                except Exception:
                    try:
                        cloud("heartbeat",connected=False,status="offline",qr_code=None,qr_expires_at=None)
                    except Exception:
                        pass
                last_hb=now
            host=cloud("host_pull")
            for cmd in host.get("commands",[]) or []:
                process_host_command(cmd)
            for hm in host.get("messages",[]) or []:
                process_host_message(hm)

            data=cloud("pull",panel_capable=panel_browser_available())
            rows=data.get("messages",[])
            local_commands=data.get("commands",[]) or []
            panel_jobs=data.get("panel_jobs",[]) or []
            for cmd in local_commands:
                process_local_command(cmd)
            if panel_jobs:
                # Modo leve para a maquina de 2 GB: executa um painel por vez
                # para evitar varios navegadores Chromium consumindo RAM ao mesmo tempo.
                for job in panel_jobs:
                    process_panel_job(job)
            if not rows and not local_commands and not panel_jobs and not host.get("messages") and not host.get("commands"):
                time.sleep(1.0)
                continue
            for m in rows:
                mid=str(m.get("id",""))
                phone=str(m.get("phone","")).strip()
                body=str(m.get("body",""))
                body=guard_repeated_reply(phone,body)
                image_data_uri=str(m.get("image_data_uri") or "").strip()
                audio_data_uri=str(m.get("audio_data_uri") or "").strip()
                delay=max(400,min(int(m.get("delay_ms") or 1200),5000))
                if not mid or not phone or (not body and not image_data_uri and not audio_data_uri):
                    ack(mid,False,error="payload inválido")
                    continue
                try:
                    presence(phone,"composing")
                    time.sleep(delay/1000.0)
                    if audio_data_uri:
                        result=send_audio(phone,audio_data_uri)
                    elif image_data_uri:
                        result=send_image(phone,body,image_data_uri)
                    else:
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