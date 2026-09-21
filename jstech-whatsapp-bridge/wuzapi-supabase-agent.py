#!/usr/bin/env python3
import json, time, urllib.request, urllib.error, subprocess, os, sys, re
from datetime import datetime, timezone, timedelta
from pathlib import Path

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
        elif action=="status":
            st=wuz_get("/session/status",token)
            d=st.get("data",{}) if isinstance(st,dict) else {}
            connected=bool(d.get("loggedIn") or d.get("LoggedIn"))
            result={"connected":connected,"ready":True,"status":"connected" if connected else "waiting_qr"}
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
        else:
            raise RuntimeError("ação desconhecida: "+action)
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
    if "just a moment" in body or "verificando" in body or "checking your browser" in body:
        page.wait_for_timeout(7000)

    if _looks_logged_in(page):
        try: context.storage_state(path=panel_session_path(panel.get("id")))
        except Exception: pass
        return True

    user=_find_input(page,"username")
    pwd=_find_input(page,"password")
    if user is None or pwd is None:
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
    code=str(job.get("panel_app_code") or "").strip()
    if not code:
        raise RuntimeError("panel_app_code_required")
    # The mapping value is intentionally used as the exact test/product selector.
    if not _click_by_text(page,[code]):
        raise RuntimeError("test_profile_not_found: "+code[:80])
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
    result["screen_count"]=screens
    result["created"]=True
    if not result.get("status"): result["status"]="active"
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

def run_panel_job(job):
    if not HAS_PLAYWRIGHT:
        raise RuntimeError("playwright_not_installed")
    panel=job.get("panel") or {}
    creds=job.get("credentials") or {}
    action=str(job.get("action_type") or "")
    state_path=panel_session_path(panel.get("id"))
    with sync_playwright() as p:
        args=["--no-sandbox","--disable-dev-shm-usage","--disable-blink-features=AutomationControlled"]
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
                return {"authenticated":True,"status":"connected"}
            if action in ("search_user","refresh_access","check_codes"):
                username=str((job.get("payload") or {}).get("username") or "").strip()
                if not username: raise RuntimeError("username_required")
                return _panel_search_user(page,username)
            if action=="test":
                return _panel_generate_test(page,job)
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
        else:
            raise RuntimeError("ação desconhecida: "+action)
    except Exception as e:
        ack_command(cid,False,error=e)

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

            data=cloud("pull",panel_capable=panel_browser_available())
            rows=data.get("messages",[])
            local_commands=data.get("commands",[]) or []
            panel_jobs=data.get("panel_jobs",[]) or []
            for cmd in local_commands:
                process_local_command(cmd)
            for job in panel_jobs:
                process_panel_job(job)
            if not rows and not local_commands and not panel_jobs and not host.get("messages") and not host.get("commands"):
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
