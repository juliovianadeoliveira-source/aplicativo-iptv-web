package com.aurora.browser;
import android.app.Application;
import android.os.Build;
import android.webkit.WebView;
public class AuroraApplication extends Application {
  @Override public void onCreate() {
    super.onCreate();
    if (Build.VERSION.SDK_INT >= 28) WebView.setDataDirectorySuffix("aurora");
  }
}
