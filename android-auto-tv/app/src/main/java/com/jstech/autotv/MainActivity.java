package com.jstech.autotv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.media3.common.MediaItem;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final String API = "https://atendimento.51-79-39-182.sslip.io/auto-tv-api/config";

    private static final int BG = Color.rgb(6, 10, 18);
    private static final int PANEL = Color.rgb(11, 18, 31);
    private static final int PANEL2 = Color.rgb(17, 28, 46);
    private static final int PANEL3 = Color.rgb(24, 37, 59);
    private static final int TEXT = Color.rgb(245, 247, 255);
    private static final int MUTED = Color.rgb(146, 159, 181);
    private static final int BLUE = Color.rgb(31, 111, 235);
    private static final int CYAN = Color.rgb(29, 199, 210);
    private static final int PURPLE = Color.rgb(124, 77, 255);
    private static final int ORANGE = Color.rgb(255, 145, 46);

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final List<Channel> channels = new ArrayList<>();

    private SharedPreferences prefs;
    private ExoPlayer player;
    private PlayerView playerView;
    private LinearLayout channelList;
    private TextView serverLabel;
    private TextView expiryLabel;
    private Button renewButton;
    private ProgressBar loading;

    private String activeServerId = "";
    private int configVersion = 0;
    private long trialExpires = 0L;
    private boolean trialReady = false;
    private Screen screen = Screen.START;

    enum Screen { START, HOME, LIVE }

    private final Runnable pollTask = new Runnable() {
        @Override public void run() {
            if (trialReady) fetchConfig(true);
            ui.postDelayed(this, 20000);
        }
    };

    private final Runnable clockTask = new Runnable() {
        @Override public void run() {
            updateExpiry();
            ui.postDelayed(this, 1000);
        }
    };

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("jstech_auto_tv", MODE_PRIVATE);
        immersive();
        showStartScreen();
        ui.post(pollTask);
        ui.post(clockTask);
    }

    private void immersive() {
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN |
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    private int dp(float v) {
        return (int)(v * getResources().getDisplayMetrics().density + .5f);
    }

    private GradientDrawable round(int color, float radius) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(dp(radius));
        return d;
    }

    private GradientDrawable gradient(int c1, int c2, float radius) {
        GradientDrawable d = new GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                new int[]{c1, c2}
        );
        d.setCornerRadius(dp(radius));
        return d;
    }

    private TextView label(String text, int size, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextSize(size);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return t;
    }

    private void applyFocusable(View v, int normal, int focused, float radius) {
        v.setFocusable(true);
        v.setClickable(true);
        v.setBackground(round(normal, radius));
        v.setOnFocusChangeListener((view, hasFocus) -> {
            view.setBackground(round(hasFocus ? focused : normal, radius));
            view.animate().scaleX(hasFocus ? 1.035f : 1f).scaleY(hasFocus ? 1.035f : 1f).setDuration(110).start();
        });
    }

    private void showStartScreen() {
        releasePlayer();
        screen = Screen.START;
        trialReady = false;
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);

        FrameLayout root = new FrameLayout(this);
        root.setBackground(gradient(Color.rgb(4, 8, 16), Color.rgb(10, 23, 42), 0));

        LinearLayout center = new LinearLayout(this);
        center.setOrientation(LinearLayout.VERTICAL);
        center.setGravity(Gravity.CENTER);
        center.setPadding(dp(28), dp(28), dp(28), dp(28));

        TextView logo = label("JSTech", 20, CYAN, true);
        logo.setGravity(Gravity.CENTER);
        center.addView(logo);

        TextView title = label("Auto TV Play+", 38, TEXT, true);
        title.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        titleLp.topMargin = dp(2);
        center.addView(title, titleLp);

        TextView sub = label("AUTO ATENDIMENTO", 12, MUTED, true);
        sub.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams subLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        subLp.topMargin = dp(7);
        center.addView(sub, subLp);

        Button generate = new Button(this);
        generate.setText("Gerar teste");
        generate.setAllCaps(false);
        generate.setTextSize(21);
        generate.setTextColor(Color.WHITE);
        generate.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        generate.setBackground(gradient(BLUE, Color.rgb(23, 77, 173), 18));
        generate.setFocusable(true);
        LinearLayout.LayoutParams bLp = new LinearLayout.LayoutParams(dp(280), dp(68));
        bLp.topMargin = dp(54);
        center.addView(generate, bLp);

        loading = new ProgressBar(this);
        loading.setVisibility(View.GONE);
        LinearLayout.LayoutParams lLp = new LinearLayout.LayoutParams(dp(38), dp(38));
        lLp.topMargin = dp(18);
        center.addView(loading, lLp);

        FrameLayout.LayoutParams cLp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        cLp.gravity = Gravity.CENTER;
        root.addView(center, cLp);

        TextView foot = label("JSTech • Android TV", 11, Color.rgb(78, 93, 115), false);
        FrameLayout.LayoutParams fLp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        fLp.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        fLp.bottomMargin = dp(22);
        root.addView(foot, fLp);

        generate.setOnFocusChangeListener((v, hasFocus) ->
                v.animate().scaleX(hasFocus ? 1.06f : 1f).scaleY(hasFocus ? 1.06f : 1f).setDuration(100).start());

        generate.setOnClickListener(v -> {
            generate.setEnabled(false);
            generate.setText("Gerando teste...");
            loading.setVisibility(View.VISIBLE);
            fetchConfigForTrial(generate);
        });

        setContentView(root);
        generate.requestFocus();
    }

    private void fetchConfigForTrial(Button generate) {
        io.execute(() -> {
            try {
                JSONObject cfg = getJson(API + "?ts=" + System.currentTimeMillis());
                if (!cfg.optBoolean("ok", false)) throw new Exception("sem servidor");

                JSONObject server = cfg.getJSONObject("server");
                activeServerId = cfg.optString("active_server_id", "");
                configVersion = cfg.optInt("version", 0);
                int hours = Math.max(1, server.optInt("trial_hours", 6));
                trialExpires = System.currentTimeMillis() + hours * 3600000L;

                prefs.edit()
                        .putString("user", "TESTE-" + randomCode(6))
                        .putString("pass", randomCode(8))
                        .putLong("expires", trialExpires)
                        .putString("server_id", activeServerId)
                        .apply();

                applyChannels(cfg.optJSONArray("channels"));
                String serverName = server.optString("name", "Servidor");
                trialReady = true;
                ui.post(() -> showHomeScreen(serverName));
            } catch (Exception e) {
                ui.post(() -> {
                    loading.setVisibility(View.GONE);
                    generate.setEnabled(true);
                    generate.setText("Gerar teste");
                    Toast.makeText(this, "Não foi possível gerar o teste.", Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private LinearLayout topBar(String serverName, boolean showBack) {
        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setPadding(dp(24), dp(14), dp(24), dp(14));
        top.setBackgroundColor(Color.rgb(7, 12, 22));

        if (showBack) {
            TextView back = label("‹", 36, TEXT, true);
            back.setGravity(Gravity.CENTER);
            applyFocusable(back, PANEL2, BLUE, 13);
            back.setOnClickListener(v -> showHomeScreen(serverName));
            top.addView(back, new LinearLayout.LayoutParams(dp(50), dp(50)));
        }

        LinearLayout brandBox = new LinearLayout(this);
        brandBox.setOrientation(LinearLayout.VERTICAL);
        TextView brand = label("JSTech Auto TV Play+", 19, TEXT, true);
        TextView server = label(serverName, 11, MUTED, false);
        brandBox.addView(brand);
        brandBox.addView(server);
        LinearLayout.LayoutParams brandLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        brandLp.leftMargin = showBack ? dp(12) : 0;
        top.addView(brandBox, brandLp);

        expiryLabel = label("", 13, TEXT, true);
        expiryLabel.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        top.addView(expiryLabel);

        renewButton = new Button(this);
        renewButton.setText("Renovar");
        renewButton.setAllCaps(false);
        renewButton.setTextColor(Color.WHITE);
        renewButton.setBackground(round(BLUE, 12));
        renewButton.setVisibility(View.GONE);
        LinearLayout.LayoutParams rLp = new LinearLayout.LayoutParams(dp(105), dp(44));
        rLp.leftMargin = dp(12);
        top.addView(renewButton, rLp);
        renewButton.setOnClickListener(v -> showRenewalDialog());

        return top;
    }

    private void showHomeScreen(String serverName) {
        releasePlayer();
        screen = Screen.HOME;
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackground(gradient(Color.rgb(6, 10, 18), Color.rgb(8, 18, 34), 0));
        root.addView(topBar(serverName, false));

        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(26), dp(18), dp(26), dp(24));

        LinearLayout hero = new LinearLayout(this);
        hero.setOrientation(LinearLayout.VERTICAL);
        hero.setPadding(dp(28), dp(22), dp(28), dp(22));
        hero.setGravity(Gravity.CENTER_VERTICAL);
        hero.setBackground(gradient(Color.rgb(20, 59, 106), Color.rgb(11, 28, 52), 22));

        TextView heroSmall = label("BEM-VINDO AO JSTech", 12, Color.rgb(164, 205, 255), true);
        hero.addView(heroSmall);
        TextView heroTitle = label("Seu entretenimento em um só lugar", 30, TEXT, true);
        LinearLayout.LayoutParams htLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        htLp.topMargin = dp(5);
        hero.addView(heroTitle, htLp);
        TextView heroSub = label("Escolha uma opção abaixo para começar.", 15, Color.rgb(193, 207, 225), false);
        LinearLayout.LayoutParams hsLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        hsLp.topMargin = dp(6);
        hero.addView(heroSub, hsLp);

        body.addView(hero, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(180)));

        TextView section = label("NAVEGAR", 12, MUTED, true);
        LinearLayout.LayoutParams secLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        secLp.topMargin = dp(22);
        secLp.bottomMargin = dp(10);
        body.addView(section, secLp);

        LinearLayout cards = new LinearLayout(this);
        cards.setOrientation(LinearLayout.HORIZONTAL);
        cards.setWeightSum(4f);

        View live = homeCard("TV AO VIVO", channels.size() + " canais", BLUE, () -> showLiveScreen(serverName));
        View movies = homeCard("FILMES", "Catálogo do servidor", PURPLE, () -> placeholder("Filmes"));
        View series = homeCard("SÉRIES", "Temporadas e episódios", CYAN, () -> placeholder("Séries"));
        View favorites = homeCard("FAVORITOS", "Acesso rápido", ORANGE, () -> placeholder("Favoritos"));

        addWeighted(cards, live, 1f, 0);
        addWeighted(cards, movies, 1f, 12);
        addWeighted(cards, series, 1f, 12);
        addWeighted(cards, favorites, 1f, 12);

        body.addView(cards, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        root.addView(body, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        setContentView(root);
        updateExpiry();
        live.requestFocus();
    }

    private View homeCard(String title, String subtitle, int accent, Runnable action) {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setGravity(Gravity.BOTTOM);
        c.setPadding(dp(20), dp(20), dp(20), dp(20));
        c.setBackground(gradient(Color.rgb(16, 26, 43), Color.rgb(9, 16, 28), 19));
        c.setFocusable(true);
        c.setClickable(true);

        TextView mark = label("●", 22, accent, true);
        LinearLayout.LayoutParams markLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, 0, 1f);
        c.addView(mark, markLp);

        TextView t = label(title, 22, TEXT, true);
        c.addView(t);
        TextView s = label(subtitle, 12, MUTED, false);
        LinearLayout.LayoutParams sLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        sLp.topMargin = dp(4);
        c.addView(s, sLp);

        c.setOnFocusChangeListener((v, hasFocus) -> {
            ((LinearLayout)v).setBackground(hasFocus
                    ? gradient(accent, Color.rgb(12, 24, 44), 19)
                    : gradient(Color.rgb(16, 26, 43), Color.rgb(9, 16, 28), 19));
            v.animate().scaleX(hasFocus ? 1.045f : 1f).scaleY(hasFocus ? 1.045f : 1f).setDuration(120).start();
        });
        c.setOnClickListener(v -> action.run());
        return c;
    }

    private void addWeighted(LinearLayout parent, View child, float weight, int leftMargin) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, weight);
        lp.leftMargin = dp(leftMargin);
        parent.addView(child, lp);
    }

    private void placeholder(String name) {
        Toast.makeText(this, name + ": aguardando conteúdo deste servidor.", Toast.LENGTH_SHORT).show();
    }

    private void showLiveScreen(String serverName) {
        releasePlayer();
        screen = Screen.LIVE;
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);
        root.addView(topBar(serverName, true));

        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.HORIZONTAL);
        body.setPadding(dp(16), dp(14), dp(16), dp(16));

        LinearLayout side = new LinearLayout(this);
        side.setOrientation(LinearLayout.VERTICAL);
        side.setPadding(dp(12), dp(12), dp(12), dp(12));
        side.setBackground(round(PANEL, 18));

        TextView liveTitle = label("TV AO VIVO", 17, TEXT, true);
        side.addView(liveTitle);
        TextView liveSub = label(channels.size() + " canais", 11, MUTED, false);
        side.addView(liveSub);

        ScrollView scroll = new ScrollView(this);
        channelList = new LinearLayout(this);
        channelList.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(channelList);
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        slp.topMargin = dp(10);
        side.addView(scroll, slp);

        LinearLayout main = new LinearLayout(this);
        main.setOrientation(LinearLayout.VERTICAL);
        main.setPadding(dp(12), dp(12), dp(12), dp(12));
        main.setBackground(round(Color.BLACK, 18));

        playerView = new PlayerView(this);
        playerView.setUseController(true);
        playerView.setBackgroundColor(Color.BLACK);
        main.addView(playerView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        LinearLayout.LayoutParams sideLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, .30f);
        LinearLayout.LayoutParams mainLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, .70f);
        mainLp.leftMargin = dp(14);

        body.addView(side, sideLp);
        body.addView(main, mainLp);

        root.addView(body, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        setContentView(root);

        player = new ExoPlayer.Builder(this).build();
        playerView.setPlayer(player);
        renderChannels(serverName);
        updateExpiry();

        if (!channels.isEmpty()) {
            playChannel(channels.get(0));
            if (channelList.getChildCount() > 0) channelList.getChildAt(1 < channelList.getChildCount() ? 1 : 0).requestFocus();
        }
    }

    private void renderChannels(String serverName) {
        if (channelList == null) return;
        channelList.removeAllViews();
        String lastGroup = null;

        for (Channel c : channels) {
            if (!c.group.equals(lastGroup)) {
                TextView g = label(c.group.toUpperCase(Locale.ROOT), 11, MUTED, true);
                g.setPadding(dp(8), dp(12), dp(8), dp(7));
                channelList.addView(g);
                lastGroup = c.group;
            }

            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.VERTICAL);
            row.setPadding(dp(14), dp(12), dp(14), dp(12));

            TextView name = label(c.name, 15, TEXT, true);
            TextView group = label(c.group, 10, MUTED, false);
            row.addView(name);
            row.addView(group);

            applyFocusable(row, PANEL2, BLUE, 12);
            row.setOnClickListener(v -> playChannel(c));

            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.bottomMargin = dp(7);
            channelList.addView(row, lp);
        }

        if (channels.isEmpty()) {
            TextView empty = label("Nenhum canal disponível.", 15, MUTED, false);
            empty.setPadding(dp(12), dp(20), dp(12), dp(20));
            channelList.addView(empty);
        }
    }

    private void playChannel(Channel c) {
        if (trialExpires > 0 && System.currentTimeMillis() >= trialExpires) {
            stopPlayback();
            showRenewalDialog();
            return;
        }
        if (player == null) return;
        player.setMediaItem(MediaItem.fromUri(c.url));
        player.prepare();
        player.play();
    }

    private void fetchConfig(boolean switchIfChanged) {
        io.execute(() -> {
            try {
                JSONObject cfg = getJson(API + "?ts=" + System.currentTimeMillis());
                if (!cfg.optBoolean("ok", false)) return;

                String sid = cfg.optString("active_server_id", "");
                int version = cfg.optInt("version", 0);
                JSONObject server = cfg.getJSONObject("server");
                String serverName = server.optString("name", "Servidor");
                boolean changed = !activeServerId.isEmpty() &&
                        (!sid.equals(activeServerId) || version != configVersion);

                activeServerId = sid;
                configVersion = version;
                applyChannels(cfg.optJSONArray("channels"));

                if (switchIfChanged && changed) {
                    ui.post(() -> {
                        Toast.makeText(this, "Servidor atualizado.", Toast.LENGTH_SHORT).show();
                        if (screen == Screen.HOME) showHomeScreen(serverName);
                        else if (screen == Screen.LIVE) showLiveScreen(serverName);
                    });
                }
            } catch (Exception ignored) {}
        });
    }

    private void applyChannels(JSONArray a) {
        synchronized (channels) {
            channels.clear();
            if (a == null) return;
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o == null) continue;
                String url = o.optString("url", "");
                if (url.isEmpty()) continue;
                channels.add(new Channel(
                        o.optString("name", "Canal"),
                        o.optString("group", "Outros"),
                        url
                ));
            }
        }
    }

    private JSONObject getJson(String address) throws Exception {
        HttpURLConnection c = (HttpURLConnection)new URL(address).openConnection();
        c.setConnectTimeout(12000);
        c.setReadTimeout(12000);
        c.setUseCaches(false);
        c.setRequestProperty("User-Agent", "JSTechAutoTV-Native/1.2");
        try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream()))) {
            StringBuilder b = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) b.append(line);
            return new JSONObject(b.toString());
        } finally {
            c.disconnect();
        }
    }

    private void updateExpiry() {
        if (!trialReady || expiryLabel == null || trialExpires <= 0) return;
        long left = trialExpires - System.currentTimeMillis();

        if (left <= 0) {
            expiryLabel.setText("TESTE ENCERRADO");
            expiryLabel.setTextColor(Color.rgb(248, 113, 113));
            if (renewButton != null) renewButton.setVisibility(View.VISIBLE);
            stopPlayback();
            return;
        }

        long total = left / 1000;
        long h = total / 3600;
        long m = (total % 3600) / 60;
        long s = total % 60;
        expiryLabel.setText(String.format(Locale.getDefault(), "%02d:%02d:%02d", h, m, s));
        expiryLabel.setTextColor(TEXT);

        if (renewButton != null) {
            renewButton.setVisibility(left <= 10 * 60 * 1000L ? View.VISIBLE : View.GONE);
        }
    }

    private void showRenewalDialog() {
        new AlertDialog.Builder(this)
                .setTitle("Renovar acesso")
                .setMessage("O teste está terminando. O módulo de pagamento e renovação automática será conectado aqui.")
                .setPositiveButton("OK", null)
                .show();
    }

    private void stopPlayback() {
        if (player != null) {
            player.stop();
            player.clearMediaItems();
        }
    }

    private void releasePlayer() {
        if (player != null) {
            player.release();
            player = null;
        }
        playerView = null;
        channelList = null;
    }

    private String randomCode(int n) {
        String chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        SecureRandom r = new SecureRandom();
        StringBuilder b = new StringBuilder();
        for (int i=0;i<n;i++) b.append(chars.charAt(r.nextInt(chars.length())));
        return b.toString();
    }

    @Override public void onBackPressed() {
        if (screen == Screen.LIVE) {
            showHomeScreen(serverLabel != null ? serverLabel.getText().toString() : "Servidor");
            return;
        }
        if (screen == Screen.HOME) {
            new AlertDialog.Builder(this)
                    .setTitle("Sair do aplicativo?")
                    .setNegativeButton("Cancelar", null)
                    .setPositiveButton("Sair", (d,w) -> finish())
                    .show();
            return;
        }
        super.onBackPressed();
    }

    @Override protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        io.shutdownNow();
        releasePlayer();
        super.onDestroy();
    }

    static class Channel {
        final String name;
        final String group;
        final String url;
        Channel(String name, String group, String url) {
            this.name = name;
            this.group = group == null || group.isEmpty() ? "Outros" : group;
            this.url = url;
        }
    }
}
