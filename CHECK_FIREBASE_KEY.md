# How to Check if You Have the Firebase Service Account Key

## Quick Check

The Firebase Service Account Key is a **JSON file** that looks like this:

```json
{
  "type": "service_account",
  "project_id": "bahumati-b4255",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-xxxxx@bahumati-b4255.iam.gserviceaccount.com",
  "client_id": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  ...
}
```

## What You Currently Have

Based on your code, you have:

- ✅ **OAuth Client IDs** (`GOOGLE_CLIENT_ID`) - Used for Google Sign-In
- ❓ **Firebase Service Account Key** - Needed for FCM push notifications

## Do You Need a New Key?

**Answer: You already have the Service Account!** ✅

I can see you have:

- ✅ Service Account: `firebase-adminsdk-fbsvc@bahumati-b4255.iam.gserviceaccount.com`

You just need to **generate/download the JSON private key** for this existing service account. You don't need to create a new service account.

## How to Get the Service Account Key

Since you already have the service account (`firebase-adminsdk`), you just need to generate the JSON key:

### Option 1: From Google Cloud Console (Current Page)

1. Click on the **service account** `firebase-adminsdk` (or click the edit icon)
2. Go to the **Keys** tab
3. Click **Add Key** → **Create new key**
4. Select **JSON** format
5. Click **Create** - the JSON file will download

### Option 2: From Firebase Console

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: **bahumati-b4255**
3. Click the gear icon ⚙️ next to "Project Overview"
4. Select **Project Settings**
5. Go to the **Service Accounts** tab
6. Click **Generate New Private Key** (for the existing `firebase-adminsdk` account)
7. A JSON file will be downloaded - **this is what you need!**

## What to Do With It

1. Open the downloaded JSON file
2. Copy the entire JSON content
3. Add it to your `.env` file as a single-line string:

```env
FIREBASE_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"bahumati-b4255",...}'
```

**Important**:

- Wrap the entire JSON in single quotes `'...'`
- Make sure it's all on one line (or properly escaped)
- This is different from your `GOOGLE_CLIENT_ID` - you need BOTH

## Summary

- **OAuth Client IDs** (what you have) = For Google Sign-In ✅
- **Service Account Key** (what you need) = For FCM push notifications ❌

You need to generate the Service Account Key - it's a one-time setup and can be used for all Firebase Admin SDK operations (FCM, Firestore, etc.).
