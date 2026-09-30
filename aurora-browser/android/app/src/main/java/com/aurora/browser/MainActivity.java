package com.aurora.browser;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.os.Build;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.inputmethod.InputMethodManager;
import android.webkit.*;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

public class MainActivity extends Activity {
  private final List<Tab> tabs = new ArrayList<>();
  private final List<String> trackers = new ArrayList<>();
  private final AtomicInteger blocked = new AtomicInteger();
  private int selected = -1;
  private boolean google = false, cleaning = false;
  private String category = "web";
  private LinearLayout root, home, nav;
  private FrameLayout content;
  private EditText address, query;
  private TextView protection;
  private Button back, forward, tabButton;
  private ProgressBar progress;
  private static final int BG = Color.rgb(16,24,39), FG = Color.rgb(233,240,252), ACCENT = Color.rgb(120,220,195);
  private static class Tab { WebView web; String title = "Nova aba"; boolean home = true; }

  @Override public void onCreate(Bundle saved) {
    super.onCreate(saved);
    root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(BG); setContentView(root);
    root.setOnApplyWindowInsetsListener((v, insets) -> { android.graphics.Insets bars = Build.VERSION.SDK_INT >= 30 ? insets.getInsets(WindowInsets.Type.systemBars()) : null; if (bars != null) v.setPadding(bars.left,bars.top,bars.right,bars.bottom); else v.setPadding(0,insets.getSystemWindowInsetTop(),0,insets.getSystemWindowInsetBottom()); return insets; });
    try (BufferedReader reader = new BufferedReader(new InputStreamReader(getAssets().open("trackers.txt"), StandardCharsets.UTF_8))) { String line; while ((line=reader.readLine())!=null) { line=line.trim(); if (!line.isEmpty() && !line.startsWith("#")) trackers.add(line); } } catch (IOException ignored) {}
    WebStorage.getInstance().deleteAllData();
    CookieManager.getInstance().removeAllCookies(value -> { if (!isFinishing()) buildUi(); });
  }
  private int dp(int n) { return Math.round(n * getResources().getDisplayMetrics().density); }
  private TextView text(String s, int size) { TextView v = new TextView(this); v.setText(s); v.setTextColor(FG); v.setTextSize(size); v.setGravity(Gravity.CENTER); return v; }
  private GradientDrawable background(int color, int radius) { GradientDrawable d = new GradientDrawable(); d.setColor(color); d.setCornerRadius(dp(radius)); return d; }
  private Button button(String label, String description, Runnable action) { Button b = new Button(this); b.setText(label); b.setTextColor(FG); b.setTextSize(14); b.setAllCaps(false); b.setMinWidth(0); b.setMinimumWidth(0); b.setPadding(dp(4),0,dp(4),0); b.setContentDescription(description); b.setBackground(background(Color.rgb(30,44,65),12)); b.setOnClickListener(v -> action.run()); return b; }
  private EditText input(String hint) { EditText e = new EditText(this); e.setSingleLine(true); e.setTextColor(FG); e.setHintTextColor(Color.rgb(163,181,204)); e.setHint(hint); e.setTextSize(15); e.setPadding(dp(14),dp(8),dp(14),dp(8)); e.setBackground(background(Color.rgb(29,42,60),20)); e.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS); e.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_GO | android.view.inputmethod.EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING); return e; }
  private void buildUi() {
    root.removeAllViews();
    LinearLayout top = new LinearLayout(this); top.setGravity(Gravity.CENTER_VERTICAL); top.setPadding(dp(8),dp(5),dp(8),dp(5));
    TextView name = text("AURORA",16); name.setTypeface(null, Typeface.BOLD); top.addView(name,new LinearLayout.LayoutParams(dp(83),dp(44)));
    address=input("Endereço ou pesquisa"); top.addView(address,new LinearLayout.LayoutParams(0,dp(44),1));
    top.addView(button("Ir","Abrir endereço",() -> navigate(address.getText().toString(),true)),new LinearLayout.LayoutParams(dp(45),dp(44))); root.addView(top);
    address.setOnEditorActionListener((v,a,e) -> { navigate(address.getText().toString(),true); return true; });
    nav = new LinearLayout(this); nav.setPadding(dp(8),dp(3),dp(8),dp(5));
    back=button("←","Voltar",() -> { Tab t=current(); if(t!=null && t.web.canGoBack()) { t.home=false; show(t); t.web.goBack(); } });
    forward=button("→","Avançar",() -> { Tab t=current(); if(t!=null && t.web.canGoForward()) { t.home=false; show(t); t.web.goForward(); } });
    Button reload=button("↻","Atualizar",() -> { Tab t=current(); if(t!=null && !t.home) t.web.reload(); });
    Button start=button("⌂","Início",() -> { Tab t=current(); if(t!=null){ t.web.stopLoading(); t.home=true; show(t); } });
    tabButton=button("1","Abas",this::tabMenu);
    Button menu=button("⋯","Menu",this::menu);
    for(Button b:new Button[]{back,forward,reload,start,tabButton,menu}) { LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0,dp(38),1); p.setMargins(dp(2),0,dp(2),0); nav.addView(b,p); } root.addView(nav);
    protection=text("Proteção por domínio ativa",11); protection.setTextColor(ACCENT); root.addView(protection,new LinearLayout.LayoutParams(-1,dp(23)));
    progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal); progress.setMax(100); root.addView(progress,new LinearLayout.LayoutParams(-1,dp(2)));
    content=new FrameLayout(this); root.addView(content,new LinearLayout.LayoutParams(-1,0,1)); buildHome();
    ServiceWorkerController.getInstance().getServiceWorkerWebSettings().setAllowFileAccess(false);
    ServiceWorkerController.getInstance().getServiceWorkerWebSettings().setAllowContentAccess(false);
    ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient(){ @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest request){ return block(request); } });
    newTab(null);
  }
  private void buildHome() {
    ScrollView scroll = new ScrollView(this); home=new LinearLayout(this); home.setOrientation(LinearLayout.VERTICAL); home.setGravity(Gravity.CENTER_HORIZONTAL); home.setPadding(dp(20),dp(40),dp(20),dp(24));
    TextView logo=text("Aurora",44); logo.setTypeface(null,Typeface.BOLD); logo.setTextColor(ACCENT); home.addView(logo);
    TextView sub=text("Explore a internet.\nCom mais privacidade.",16); sub.setPadding(0,dp(16),0,dp(28)); home.addView(sub);
    query=input("O que você quer encontrar?"); home.addView(query,new LinearLayout.LayoutParams(-1,dp(52)));
    Button search=button("Pesquisar","Pesquisar na internet",() -> navigate(query.getText().toString(),false)); LinearLayout.LayoutParams sp=new LinearLayout.LayoutParams(-1,dp(48)); sp.topMargin=dp(12); home.addView(search,sp);
    query.setOnEditorActionListener((v,a,e) -> { navigate(query.getText().toString(),false); return true; });
    String[] labels={"Tudo","Imagens","Vídeos","Notícias","Mapas"}, values={"web","images","videos","news","maps"};
    HorizontalScrollView categories=new HorizontalScrollView(this); LinearLayout row=new LinearLayout(this); row.setPadding(0,dp(18),0,dp(18));
    for(int i=0;i<labels.length;i++){ final String value=values[i]; Button b=button(labels[i],labels[i],() -> { category=value; for(int j=0;j<row.getChildCount();j++) row.getChildAt(j).setBackground(background(Color.rgb(30,44,65),12)); for(int j=0;j<row.getChildCount();j++){ Button child=(Button)row.getChildAt(j); if(value.equals(child.getTag()))child.setBackground(background(Color.rgb(35,102,89),12)); } }); b.setTag(value); if("web".equals(value)) b.setBackground(background(Color.rgb(35,102,89),12)); LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(dp(95),dp(42)); p.setMargins(dp(3),0,dp(3),0); row.addView(b,p); } categories.addView(row); home.addView(categories);
    Button engine=button("Buscador: DuckDuckGo","Escolher buscador",() -> new AlertDialog.Builder(this).setTitle("Buscador").setSingleChoiceItems(new String[]{"DuckDuckGo","Google"},google?1:0,(d,n) -> {google=n==1;((Button)home.findViewWithTag("engine")).setText("Buscador: "+(google?"Google":"DuckDuckGo"));d.dismiss();}).show()); engine.setTag("engine"); home.addView(engine);
    TextView note=text("Os sites abrem dentro do Aurora.\nUsar Google envia sua pesquisa ao Google.",12); note.setPadding(0,dp(22),0,0); home.addView(note); scroll.addView(home); content.addView(scroll,new FrameLayout.LayoutParams(-1,-1)); scroll.setTag("home");
  }
  private Tab current(){return selected>=0 && selected<tabs.size()?tabs.get(selected):null;}
  private void newTab(String url){
    if(tabs.size()>=20){Toast.makeText(this,"Feche uma aba antes de abrir outra (limite de 20).",Toast.LENGTH_SHORT).show();return;}
    Tab t=new Tab(); t.web=new WebView(this); WebSettings s=t.web.getSettings();
    s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setCacheMode(WebSettings.LOAD_NO_CACHE);s.setSaveFormData(false);s.setDatabaseEnabled(false);s.setGeolocationEnabled(false);s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setAllowFileAccessFromFileURLs(false);s.setAllowUniversalAccessFromFileURLs(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setSupportMultipleWindows(true);s.setJavaScriptCanOpenWindowsAutomatically(false);s.setBuiltInZoomControls(true);s.setDisplayZoomControls(false);s.setLoadWithOverviewMode(true);s.setUseWideViewPort(true);s.setSafeBrowsingEnabled(true);
    CookieManager.getInstance().setAcceptThirdPartyCookies(t.web,false); t.web.clearCache(true); t.web.clearHistory();
    t.web.setWebViewClient(new WebViewClient(){
      @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request){if(!BrowserPolicy.safeUrl(request.getUrl().toString())){Toast.makeText(MainActivity.this,"Este tipo de link não é permitido.",Toast.LENGTH_SHORT).show();return true;}return false;}
      @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){return request.isForMainFrame()?null:block(request);}
      @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){t.home=false;if(t==current()){address.setText(url);show(t);}update();}
      @Override public void onPageFinished(WebView view,String url){if(t==current())address.setText(url);update();}
      @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,android.net.http.SslError error){handler.cancel();Toast.makeText(MainActivity.this,"Certificado inválido. A conexão foi bloqueada.",Toast.LENGTH_LONG).show();}
      @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame() && t==current())Toast.makeText(MainActivity.this,"Não foi possível abrir: "+error.getDescription(),Toast.LENGTH_LONG).show();}
    });
    t.web.setWebChromeClient(new WebChromeClient(){
      @Override public void onProgressChanged(WebView view,int value){if(t==current())progress.setProgress(value);}
      @Override public void onReceivedTitle(WebView view,String title){t.title=title==null?"Página":title;update();}
      @Override public void onPermissionRequest(PermissionRequest request){request.deny();}
      @Override public void onGeolocationPermissionsShowPrompt(String origin,GeolocationPermissions.Callback callback){callback.invoke(origin,false,false);}
      @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){callback.onReceiveValue(null);Toast.makeText(MainActivity.this,"Envio de arquivos está bloqueado nesta versão.",Toast.LENGTH_SHORT).show();return true;}
      @Override public boolean onCreateWindow(WebView view,boolean dialog,boolean gesture,android.os.Message result){
        if(!gesture)return false;
        WebView popup=new WebView(MainActivity.this); popup.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest request){String target=request.getUrl().toString();if(BrowserPolicy.safeUrl(target))newTab(target);v.post(v::destroy);return true;}});
        ((WebView.WebViewTransport)result.obj).setWebView(popup);result.sendToTarget();return true;
      }
    });
    t.web.setDownloadListener((u,a,c,m,l) -> Toast.makeText(this,"Downloads estão bloqueados nesta versão privada.",Toast.LENGTH_LONG).show());
    tabs.add(t); selected=tabs.size()-1; content.addView(t.web,new FrameLayout.LayoutParams(-1,-1)); show(t);if(url!=null){t.home=false;show(t);t.web.loadUrl(url,privacyHeaders());}
  }
  private Map<String,String> privacyHeaders(){Map<String,String> h=new HashMap<>();h.put("DNT","1");h.put("Sec-GPC","1");return h;}
  private WebResourceResponse block(WebResourceRequest request){if(BrowserPolicy.tracker(request.getUrl().getHost(),trackers)){blocked.incrementAndGet();runOnUiThread(this::update);return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));}return null;}
  private void show(Tab tab){for(Tab t:tabs)t.web.setVisibility(t==tab&&!t.home?View.VISIBLE:View.GONE);View start=content.findViewWithTag("home");start.setVisibility(tab.home?View.VISIBLE:View.GONE);if(tab.home){query.setText("");address.setText("");progress.setProgress(0);}else address.setText(tab.web.getUrl());update();}
  private void update(){if(protection==null)return;protection.setText("Proteção ativa · "+blocked.get()+" solicitações bloqueadas");tabButton.setText(String.valueOf(tabs.size()));Tab t=current();back.setEnabled(t!=null&&t.web.canGoBack());forward.setEnabled(t!=null&&t.web.canGoForward());}
  private void navigate(String value,boolean fromAddress){try{String target=fromAddress?BrowserPolicy.destination(value,google,category):BrowserPolicy.search(value,google,category);if(target==null||value.trim().isEmpty())return;Tab t=current();if(t==null)return;t.home=false;show(t);address.setText(target);((InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(address.getWindowToken(),0);address.clearFocus();query.clearFocus();t.web.loadUrl(target,privacyHeaders());}catch(Exception e){Toast.makeText(this,e.getMessage(),Toast.LENGTH_LONG).show();}}
  private void tabMenu(){String[] names=new String[tabs.size()+1];for(int i=0;i<tabs.size();i++)names[i]=(i==selected?"• ":"")+tabs.get(i).title;names[tabs.size()]="+ Nova aba";new AlertDialog.Builder(this).setTitle("Abas").setItems(names,(d,n)->{if(n==tabs.size())newTab(null);else{selected=n;show(current());}}).setNeutralButton("Fechar atual",(d,n)->closeTab()).show();}
  private void closeTab(){Tab t=current();if(t==null)return;content.removeView(t.web);t.web.stopLoading();t.web.destroy();tabs.remove(selected);if(tabs.isEmpty()){selected=-1;newTab(null);}else{selected=Math.min(selected,tabs.size()-1);show(current());}}
  private void menu(){new AlertDialog.Builder(this).setTitle("Aurora").setItems(new String[]{"Nova aba","Limpar sessão","Sobre e privacidade","Fechar Aurora"},(d,n)->{switch(n){case 0:newTab(null);break;case 1:clear(false);break;case 2:new AlertDialog.Builder(this).setTitle("Aurora 0.1.0 · Prévia").setMessage("Navegador com abas, bloqueio básico por domínio e cookies de terceiros bloqueados. Não oculta seu IP e não impede todo rastreamento. Sem analytics próprios. Dados são limpos ao abrir o aplicativo, ao limpar a sessão e ao usar Fechar Aurora. Se o Android encerrar o processo, resíduos podem permanecer até a próxima abertura. Localização, câmera, microfone, downloads e envio de arquivos estão bloqueados nesta versão. O motor é o Android System WebView; mantenha-o atualizado.").setPositiveButton("OK",null).show();break;case 3:clear(true);break;}}).show();}
  private void clear(boolean exit){if(cleaning)return;cleaning=true;for(Tab t:tabs){content.removeView(t.web);t.web.stopLoading();t.web.clearCache(true);t.web.clearHistory();t.web.clearFormData();t.web.destroy();}tabs.clear();selected=-1;WebStorage.getInstance().deleteAllData();CookieManager.getInstance().removeAllCookies(v->{blocked.set(0);cleaning=false;if(exit)finishAndRemoveTask();else if(!isFinishing())newTab(null);});}
  @Override public void onBackPressed(){Tab t=current();if(t!=null&&!t.home&&t.web.canGoBack()){t.web.goBack();}else if(t!=null&&!t.home){t.home=true;show(t);}else new AlertDialog.Builder(this).setTitle("Fechar Aurora?").setMessage("As abas e os dados desta sessão serão limpos.").setPositiveButton("Fechar",(d,n)->clear(true)).setNegativeButton("Continuar",null).show();}
  @Override protected void onDestroy(){for(Tab t:tabs){t.web.stopLoading();t.web.destroy();}tabs.clear();super.onDestroy();}
}
