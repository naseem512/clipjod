package com.clipjod.editor;

import android.os.Bundle;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The editor starts the next clip's video and the music by itself while playing and exporting,
        // so media must be allowed to play without a fresh tap each time.
        WebSettings settings = this.bridge.getWebView().getSettings();
        settings.setMediaPlaybackRequiresUserGesture(false);
    }
}
