package com.azantv.dkm;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

/**
 * Phone app for DKM members: the takmir panel (/login → /admin) in a WebView.
 *
 * - Login session lives in the WebView's localStorage, so members stay signed in.
 * - Photo uploads (background, poster slides) open the system file/photo picker.
 * - Links outside the panel (e.g. the TV display page) open in the browser.
 * - Back navigates inside the panel before leaving the app.
 * - Shows a retry screen when offline and reloads when the network returns.
 */
public class MainActivity extends Activity {

    private static final String BASE_URL = BuildConfig.BASE_URL;
    private static final String START_URL = BASE_URL + "/login";
    private static final int REQUEST_FILE = 1001;
    private static final int BRAND = 0xFF115E59;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback networkCallback;
    private boolean showingError = false;
    private String lastUrl = START_URL;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setupWindow();

        root = new FrameLayout(this);
        root.setBackgroundColor(BRAND); // shows behind the status bar
        root.setOnApplyWindowInsetsListener(this::applyInsets);
        setContentView(root);

        createWebView();
        registerNetworkCallback();

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(START_URL);
        }
    }

    @SuppressWarnings("deprecation")
    private void setupWindow() {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT < 35) {
            w.setStatusBarColor(BRAND);
            w.setNavigationBarColor(Color.WHITE);
        }
        // Light (white) status bar icons on the teal bar
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                c.setSystemBarsAppearance(0, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
                c.setSystemBarsAppearance(WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                        WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
            }
        } else {
            View decor = w.getDecorView();
            int flags = decor.getSystemUiVisibility() & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            decor.setSystemUiVisibility(flags);
        }
    }

    /** Keep the WebView clear of the status bar, navigation bar and keyboard. */
    @SuppressWarnings("deprecation")
    private WindowInsets applyInsets(View v, WindowInsets insets) {
        int left, top, right, bottom;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            android.graphics.Insets bars = insets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
            left = bars.left;
            top = bars.top;
            right = bars.right;
            bottom = Math.max(bars.bottom, ime.bottom);
        } else {
            left = insets.getSystemWindowInsetLeft();
            top = insets.getSystemWindowInsetTop();
            right = insets.getSystemWindowInsetRight();
            bottom = insets.getSystemWindowInsetBottom();
        }
        v.setPadding(left, top, right, bottom);
        return insets;
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void createWebView() {
        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);   // login token + remembered username
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);  // photos picked from the gallery
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUserAgentString(s.getUserAgentString() + " AzanTV-DKM/" + BuildConfig.VERSION_NAME);

        webView.setWebViewClient(new PanelWebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            // alert / confirm / prompt use WebView's built-in dialogs (default behaviour)

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQUEST_FILE);
                    return true;
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, R.string.no_file_picker, Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });

        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_FILE) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private boolean isPanelUrl(Uri uri) {
        Uri base = Uri.parse(BASE_URL);
        if (!"https".equals(uri.getScheme()) || base.getHost() == null
                || !base.getHost().equalsIgnoreCase(uri.getHost())) {
            return false;
        }
        // The TV display page registers itself as a TV; keep it out of the phone app.
        String path = uri.getPath() == null ? "" : uri.getPath();
        return !(path.equals("/tv") || path.startsWith("/tv/"));
    }

    private void openExternally(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.no_browser, Toast.LENGTH_SHORT).show();
        }
    }

    private class PanelWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isPanelUrl(uri)) return false;
            openExternally(uri);
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (url != null && url.startsWith(BASE_URL)) {
                lastUrl = url;
                showingError = false;
            }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) {
                showOfflineScreen(request.getUrl().toString());
            }
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            handler.post(() -> {
                root.removeView(webView);
                webView.destroy();
                createWebView();
                webView.loadUrl(lastUrl);
            });
            return true;
        }
    }

    private void showOfflineScreen(String failedUrl) {
        showingError = true;
        if (failedUrl != null && failedUrl.startsWith(BASE_URL)) lastUrl = failedUrl;
        String retry = lastUrl.replace("\"", "%22");
        String html = "<!doctype html><html><head><meta charset='utf-8'>"
                + "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                + "<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;"
                + "font-family:sans-serif;background:#F8FAFC;color:#0F172A;text-align:center;padding:24px;box-sizing:border-box}"
                + "h1{font-size:20px;margin:0 0 8px}p{color:#475569;margin:0 0 24px;line-height:1.5}"
                + "a{display:inline-block;background:#0F766E;color:#fff;text-decoration:none;padding:12px 24px;"
                + "border-radius:8px;font-weight:600}</style></head><body><div>"
                + "<h1>Tidak ada koneksi</h1>"
                + "<p>Panel takmir butuh internet. Periksa Wi-Fi atau data seluler, lalu coba lagi.</p>"
                + "<a href=\"" + retry + "\">Coba lagi</a></div></body></html>";
        webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    private void registerNetworkCallback() {
        connectivity = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivity == null) return;
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                handler.post(() -> {
                    if (showingError) {
                        showingError = false;
                        webView.loadUrl(lastUrl);
                    }
                });
            }
        };
        try {
            connectivity.registerDefaultNetworkCallback(networkCallback);
        } catch (RuntimeException e) {
            networkCallback = null;
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (showingError) {
            super.onBackPressed();
            return;
        }
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
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
        if (fileCallback != null) {
            fileCallback.onReceiveValue(null);
            fileCallback = null;
        }
        if (webView != null) {
            root.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
