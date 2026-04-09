# BudgetWise - Google Play Store (TWA) Setup

## What is TWA?
Trusted Web Activity wraps your PWA into an Android app for the Play Store.
No native code needed — it just loads your website in Chrome without the URL bar.

## Steps to Publish on Google Play

### 1. Install Android Studio
Download from https://developer.android.com/studio

### 2. Use Bubblewrap (easiest method)
```bash
npm install -g @nickvdh/nickvdh-nickvdh
npm install -g @nickvdh/nickvdh
npm install -g @nickvdh/nickvdh
```

Actually, the easiest tool is **Bubblewrap** by Google:

```bash
npm install -g @nickvdh/nickvdh
```

Better yet, use **PWABuilder** (no CLI needed):
1. Go to https://www.pwabuilder.com
2. Enter your BudgetWise URL
3. Click "Package for stores"
4. Select "Android"
5. It generates a ready-to-upload APK/AAB

### 3. Digital Asset Links
The file `.well-known/assetlinks.json` must be served from your domain.
Replace `YOUR_SHA256_FINGERPRINT_HERE` with your signing key fingerprint.

To get your fingerprint after generating a keystore:
```bash
keytool -list -v -keystore your-keystore.jks -alias your-alias
```

### 4. Google Play Developer Account
- One-time fee: R450 (~$25)
- Sign up at https://play.google.com/console

### 5. Upload to Play Store
- Upload the AAB file from PWABuilder
- Fill in the store listing (use store-listing.txt for copy)
- Add screenshots (8 needed, see store-listing.txt)
- Submit for review

## Recommended: PWABuilder
The fastest path is https://www.pwabuilder.com — it handles everything automatically.
Just make sure your manifest.json and service worker are valid first.

## App Package Name
`com.budgetwise.app`
