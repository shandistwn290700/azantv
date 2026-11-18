package com.azantv.display;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

/**
 * Full-screen WebView wrapper for the Azan TV display page.
 *
 * - Keeps the screen on and hides system UI (digital signage).
 * - Allows Web Audio to play without a remote-button press (azan beep).
 * - When offline, shows the last cached copy of the page; if there is none,
 *   shows a status screen and retries until the network comes back.
 * - Recovers from a crashed WebView renderer instead of closing the app.
 * - Back must be pressed twice to exit, so a stray press doesn't close it.
 */
public class MainActivity extends Activity {

    private static final String TV_URL = BuildConfig.TV_URL;
    private static final long RETRY_DELAY_MS = 15_000;
    private static final long BACK_EXIT_WINDOW_MS = 2_000;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private FrameLayout container;
    private WebView webView;
    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback networkCallback;
    private boolean showingError = false;
    private long lastBackPress = 0;

    private final Runnable retryLoad = this::loadTvPage;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        container = new FrameLayout(this);
        container.setBackgroundColor(0xFF000000);
        setContentView(container);

        createWebView();
        registerNetworkCallback();
        loadTvPage();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void createWebView() {
        webView = new WebView(this);
        webView.setBackgroundColor(0xFF000000);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage: client id + offline data cache
        s.setMediaPlaybackRequiresUserGesture(false); // azan beep via Web Audio API
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUserAgentString(s.getUserAgentString() + " AzanTV-Android/" + BuildConfig.VERSION_NAME);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new TvWebViewClient());

        container.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.requestFocus();
    }

    private void loadTvPage() {
        handler.removeCallbacks(retryLoad);
        showingError = false;
        // Offline: fall back to the cached page so the schedule keeps running
        // (prayer times are computed in the browser from cached settings).
        webView.getSettings().setCacheMode(isOnline()
                ? WebSettings.LOAD_DEFAULT
                : WebSettings.LOAD_CACHE_ELSE_NETWORK);
        webView.loadUrl(TV_URL);
    }

    private void showOfflineScreen(String reason) {
        if (showingError) return;
        showingError = true;
        String html = "<!doctype html><html><head><meta charset='utf-8'>"
                + "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                + "<style>html,body{margin:0;height:100%;background:#0b1f24;color:#e6f2f0;"
                + "font-family:sans-serif;display:flex;align-items:center;justify-content:center;text-align:center}"
                + "h1{font-size:4vw;margin:0 0 2vh}p{font-size:2vw;opacity:.75;margin:.5vh 0}</style></head>"
                + "<body><div><h1>Menunggu koneksi internet…</h1>"
                + "<p>Jadwal azan akan tampil otomatis setelah TV tersambung.</p>"
                + "<p style='font-size:1.4vw;opacity:.5'>" + escapeHtml(reason) + "</p></div></body></html>";
        webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
        handler.removeCallbacks(retryLoad);
        handler.postDelayed(retryLoad, RETRY_DELAY_MS);
    }

    private boolean isOnline() {
        if (connectivity == null) return true;
        Network n = connectivity.getActiveNetwork();
        if (n == null) return false;
        NetworkCapabilities caps = connectivity.getNetworkCapabilities(n);
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private void registerNetworkCallback() {
        connectivity = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivity == null) return;
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                // Network is back: reload right away instead of waiting for the retry timer.
                handler.post(() -> {
                    if (showingError) loadTvPage();
                });
            }
        };
        try {
            connectivity.registerDefaultNetworkCallback(networkCallback);
        } catch (RuntimeException e) {
            networkCallback = null;
        }
    }

    private void recreateWebView() {
        if (webView != null) {
            container.removeView(webView);
            webView.destroy();
        }
        createWebView();
        loadTvPage();
    }

    private class TvWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return false; // keep every navigation inside the app
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) {
                showOfflineScreen(error.getDescription() == null ? "" : error.getDescription().toString());
            }
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // The renderer crashed or was killed for memory: rebuild instead of letting the app die.
            handler.post(MainActivity.this::recreateWebView);
            return true;
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            long now = SystemClock.elapsedRealtime();
            if (now - lastBackPress < BACK_EXIT_WINDOW_MS) {
                finish();
            } else {
                lastBackPress = now;
                Toast.makeText(this, R.string.press_back_again, Toast.LENGTH_SHORT).show();
            }
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @SuppressWarnings("deprecation")
    private void hideSystemUi() {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            w.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (connectivity != null && networkCallback != null) {
            try {
                connectivity.unregisterNetworkCallback(networkCallback);
            } catch (RuntimeException ignored) {
            }
        }
        if (webView != null) {
            container.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private static String escapeHtml(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
