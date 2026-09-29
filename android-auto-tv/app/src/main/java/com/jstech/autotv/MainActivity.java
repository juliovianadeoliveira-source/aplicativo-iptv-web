package com.jstech.autotv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
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
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
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
    private static final int BG = Color.rgb(5, 9, 19);
    private static final int PANEL = Color.rgb(13, 22, 39);
    private static final int PANEL2 = Color.rgb(20, 31, 50);
    private static final int TEXT = Color.rgb(238, 242, 255);
    private static final int MUTED = Color.rgb(148, 163, 184);
    private static final int ACCENT = Color.rgb(37, 99, 235);

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final List<Channel> channels = new ArrayList<>();

    private SharedPreferences prefs;
    private ExoPlayer player;
    private PlayerView playerView;
    private LinearLayout channelList;
    private TextView serverLabel;
    private TextView expiryLabel;
    private ProgressBar loading;
    private Button renewButton;

    private String activeServerId = "";
    private int configVersion = 0;
    private long trialExpires = 0L;
    private boolean insidePlayer = false;

    private final Runnable pollTask = new Runnable() {
        @Override public void run() {
            if (insidePlayer) fetchConfig(true);
            ui.postDelayed(this, 20000);
        }
    };

    private final Runnable clockTask = new Runnable() {
        @Override public void run() {
            updateExpiry();
            ui.postDelayed(this, 1000);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
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

    private TextView text(String value, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextSize(sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return t;
    }

    private GradientDrawable rounded(int color, float radiusDp) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(dp(radiusDp));
        return d;
    }

    private int dp(float v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }

    private void showStartScreen() {
        insidePlayer = false;
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(BG);
        root.setPadding(dp(24), dp(24), dp(24), dp(24));

        TextView title = text("JSTech Auto TV Play+", 30, TEXT, true);
        title.setGravity(Gravity.CENTER);
        root.addView(title, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView sub = text("Auto Atendimento", 15, MUTED, false);
        sub.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams subLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        subLp.topMargin = dp(6);
        root.addView(sub, subLp);

        Button generate = new Button(this);
        generate.setText("Gerar teste");
        generate.setTextSize(22);
        generate.setTextColor(Color.WHITE);
        generate.setAllCaps(false);
        generate.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        generate.setBackground(rounded(ACCENT, 16));
        LinearLayout.LayoutParams bLp = new LinearLayout.LayoutParams(dp(280), dp(70));
        bLp.topMargin = dp(58);
        root.addView(generate, bLp);

        loading = new ProgressBar(this);
        loading.setVisibility(View.GONE);
        LinearLayout.LayoutParams loadLp = new LinearLayout.LayoutParams(dp(42), dp(42));
        loadLp.topMargin = dp(20);
        root.addView(loading, loadLp);

        generate.setOnClickListener(v -> {
            generate.setEnabled(false);
            generate.setText("Gerando teste...");
            loading.setVisibility(View.VISIBLE);
            fetchConfigForTrial(generate);
        });

        setContentView(root);
    }

    private void fetchConfigForTrial(Button generate) {
        io.execute(() -> {
            try {
                JSONObject cfg = getJson(API + "?ts=" + System.currentTimeMillis());
                if (!cfg.optBoolean("ok", false)) throw new Exception("sem servidor ativo");

                JSONObject server = cfg.getJSONObject("server");
                activeServerId = cfg.getString("active_server_id");
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
                ui.post(() -> showPlayerScreen(serverName));
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

    private void showPlayerScreen(String serverName) {
        insidePlayer = true;
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setPadding(dp(16), dp(10), dp(16), dp(10));
        top.setBackgroundColor(PANEL);

        LinearLayout brandBox = new LinearLayout(this);
        brandBox.setOrientation(LinearLayout.VERTICAL);
        TextView brand = text("JSTech Auto TV Play+", 20, TEXT, true);
        serverLabel = text(serverName, 12, MUTED, false);
        brandBox.addView(brand);
        brandBox.addView(serverLabel);
        top.addView(brandBox, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        expiryLabel = text("", 13, TEXT, true);
        expiryLabel.setGravity(Gravity.END);
        top.addView(expiryLabel);

        renewButton = new Button(this);
        renewButton.setText("Renovar");
        renewButton.setAllCaps(false);
        renewButton.setTextColor(Color.WHITE);
        renewButton.setBackground(rounded(ACCENT, 12));
        renewButton.setVisibility(View.GONE);
        LinearLayout.LayoutParams renewLp = new LinearLayout.LayoutParams(dp(110), dp(48));
        renewLp.leftMargin = dp(10);
        top.addView(renewButton, renewLp);
        renewButton.setOnClickListener(v -> showRenewalDialog());

        root.addView(top, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        boolean landscape = getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(landscape ? LinearLayout.HORIZONTAL : LinearLayout.VERTICAL);
        content.setPadding(dp(10), dp(10), dp(10), dp(10));

        LinearLayout listPanel = new LinearLayout(this);
        listPanel.setOrientation(LinearLayout.VERTICAL);
        listPanel.setPadding(dp(10), dp(10), dp(10), dp(10));
        listPanel.setBackground(rounded(PANEL, 14));

        TextView liveTitle = text("TV AO VIVO", 18, TEXT, true);
        listPanel.addView(liveTitle);

        ScrollView scroll = new ScrollView(this);
        channelList = new LinearLayout(this);
        channelList.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(channelList);
        LinearLayout.LayoutParams scrollLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        scrollLp.topMargin = dp(8);
        listPanel.addView(scroll, scrollLp);

        LinearLayout playerPanel = new LinearLayout(this);
        playerPanel.setOrientation(LinearLayout.VERTICAL);
        playerPanel.setPadding(dp(10), dp(10), dp(10), dp(10));
        playerPanel.setBackground(rounded(Color.BLACK, 14));

        playerView = new PlayerView(this);
        playerView.setUseController(true);
        playerView.setBackgroundColor(Color.BLACK);
        playerPanel.addView(playerView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        if (landscape) {
            content.addView(listPanel, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 0.34f));
            LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 0.66f);
            pp.leftMargin = dp(10);
            content.addView(playerPanel, pp);
        } else {
            content.addView(playerPanel, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(260)));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
            lp.topMargin = dp(10);
            content.addView(listPanel, lp);
        }

        root.addView(content, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);

        player = new ExoPlayer.Builder(this).build();
        playerView.setPlayer(player);
        renderChannels();
        updateExpiry();

        if (!channels.isEmpty()) playChannel(channels.get(0));
    }

    private void renderChannels() {
        if (channelList == null) return;
        channelList.removeAllViews();

        String lastGroup = null;
        for (Channel c : channels) {
            if (!c.group.equals(lastGroup)) {
                TextView group = text(c.group.toUpperCase(Locale.ROOT), 12, MUTED, true);
                group.setPadding(dp(8), dp(14), dp(8), dp(6));
                channelList.addView(group);
                lastGroup = c.group;
            }

            TextView row = text(c.name, 16, TEXT, true);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setPadding(dp(14), dp(12), dp(14), dp(12));
            row.setBackground(rounded(PANEL2, 11));
            row.setFocusable(true);
            row.setClickable(true);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.bottomMargin = dp(7);
            channelList.addView(row, lp);
            row.setOnClickListener(v -> playChannel(c));
            row.setOnFocusChangeListener((v, hasFocus) -> {
                v.setBackground(rounded(hasFocus ? ACCENT : PANEL2, 11));
            });
        }

        if (channels.isEmpty()) {
            TextView empty = text("Nenhum canal disponível neste servidor.", 15, MUTED, false);
            empty.setPadding(dp(10), dp(20), dp(10), dp(20));
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
                boolean changed = !activeServerId.isEmpty() &&
                        (!sid.equals(activeServerId) || version != configVersion);

                activeServerId = sid;
                configVersion = version;
                applyChannels(cfg.optJSONArray("channels"));

                if (switchIfChanged && changed) {
                    ui.post(() -> {
                        if (serverLabel != null) serverLabel.setText(server.optString("name", "Servidor"));
                        renderChannels();
                        stopPlayback();
                        if (!channels.isEmpty()) playChannel(channels.get(0));
                        Toast.makeText(this, "Servidor atualizado automaticamente.", Toast.LENGTH_SHORT).show();
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
        HttpURLConnection c = (HttpURLConnection) new URL(address).openConnection();
        c.setConnectTimeout(12000);
        c.setReadTimeout(12000);
        c.setRequestProperty("User-Agent", "JSTechAutoTV-Native/1.1");
        c.setUseCaches(false);
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
        if (!insidePlayer || expiryLabel == null || trialExpires <= 0) return;
        long left = trialExpires - System.currentTimeMillis();
        if (left <= 0) {
            expiryLabel.setText("TESTE ENCERRADO");
            expiryLabel.setTextColor(Color.rgb(248, 113, 113));
            renewButton.setVisibility(View.VISIBLE);
            stopPlayback();
            return;
        }
        long totalSeconds = left / 1000;
        long h = totalSeconds / 3600;
        long m = (totalSeconds % 3600) / 60;
        long s = totalSeconds % 60;
        expiryLabel.setText(String.format(Locale.getDefault(), "Teste %02d:%02d:%02d", h, m, s));
        if (left <= 10 * 60 * 1000L) renewButton.setVisibility(View.VISIBLE);
    }

    private void showRenewalDialog() {
        new AlertDialog.Builder(this)
                .setTitle("Renovar acesso")
                .setMessage("Seu teste está terminando. A próxima etapa liga este botão ao pagamento e à renovação automática do servidor.")
                .setPositiveButton("OK", null)
                .show();
    }

    private void stopPlayback() {
        if (player != null) {
            player.stop();
            player.clearMediaItems();
        }
    }

    private String randomCode(int n) {
        String chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        SecureRandom r = new SecureRandom();
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < n; i++) b.append(chars.charAt(r.nextInt(chars.length())));
        return b.toString();
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        io.shutdownNow();
        if (player != null) player.release();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (insidePlayer) {
            new AlertDialog.Builder(this)
                    .setTitle("Sair do aplicativo?")
                    .setNegativeButton("Cancelar", null)
                    .setPositiveButton("Sair", (d, w) -> finish())
                    .show();
        } else {
            super.onBackPressed();
        }
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
