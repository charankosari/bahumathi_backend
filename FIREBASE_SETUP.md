# Firebase Cloud Messaging (FCM) Setup Guide

This guide will help you set up Firebase Cloud Messaging (FCM) for real-time push notifications in your Bahumati backend.

## Prerequisites

1. A Firebase project (you already have one: `bahumati-b4255`)
2. Firebase Admin SDK service account key
3. Node.js backend with `firebase-admin` package installed

## Step 1: Get Firebase Service Account Key

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: **bahumati-b4255**
3. Click on the gear icon ⚙️ next to "Project Overview"
4. Select **Project Settings**
5. Go to the **Service Accounts** tab
6. Click **Generate New Private Key**
7. A JSON file will be downloaded - this is your service account key

## Step 2: Configure Environment Variable

You need to add the Firebase service account key to your backend `.env` file.

### Option A: Store as JSON String (Recommended)

1. Open the downloaded JSON file
2. Copy the entire JSON content
3. Convert it to a single-line string (remove all newlines and extra spaces)
4. Add it to your `.env` file:

```env
FIREBASE_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"bahumati-b4255",...}'
```

**Important:** Make sure to:

- Wrap the entire JSON in single quotes `'...'`
- Escape any single quotes inside the JSON with `\'`
- Or use double quotes and escape double quotes inside

### Option B: Store as Base64 (Alternative)

If you prefer, you can base64 encode the JSON file:

```bash
# On Linux/Mac
base64 -i path/to/service-account-key.json

# On Windows (PowerShell)
[Convert]::ToBase64String([IO.File]::ReadAllBytes("path/to/service-account-key.json"))
```

Then in your `.env`:

```env
FIREBASE_SERVICE_ACCOUNT_KEY_BASE64='<base64-encoded-string>'
```

(Note: You'll need to update `fcm.service.js` to decode base64 if using this method)

## Step 3: Install Dependencies

The `firebase-admin` package should already be in your `package.json`. Install it:

```bash
cd bahumathi_backend
npm install
```

## Step 4: Verify Setup

1. Start your backend server:

```bash
npm start
```

2. Check the console logs. You should see:
   - ✅ `Firebase Admin SDK initialized successfully` (if setup is correct)
   - ⚠️ `FIREBASE_SERVICE_ACCOUNT_KEY not set. Push notifications will be disabled.` (if not configured)

## Step 5: Test Push Notifications

### Backend API Endpoint

Update FCM token for a user:

```http
POST /api/v1/users/me/fcm-token
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "fcmToken": "<fcm_token_from_flutter_app>"
}
```

### When Notifications Are Sent

Push notifications are automatically sent when:

1. **Message Sent**: When a user sends a message and the receiver is offline
2. **Gift Sent**: When a user sends a gift and the receiver is offline
3. **Gift with Message**: When a user sends a gift with a message and the receiver is offline
4. **Gift Payment Captured**: When a Razorpay payment is captured for a gift

### Notification Logic

- Notifications are only sent if the receiver is **offline** (not connected via Socket.IO)
- If the receiver is online, they receive real-time updates via Socket.IO instead
- Notifications include sender name, message/gift details, and deep link data

## Step 6: Flutter App Setup

In your Flutter app, you need to:

1. **Install Firebase packages**:

```yaml
dependencies:
  firebase_core: ^2.24.2
  firebase_messaging: ^14.7.9
```

2. **Initialize Firebase** in your Flutter app
3. **Get FCM token** and send it to the backend via the `/api/v1/users/me/fcm-token` endpoint
4. **Handle incoming notifications** when the app is in foreground/background/terminated

## Troubleshooting

### Issue: "Firebase not initialized" error

**Solution**:

- Check that `FIREBASE_SERVICE_ACCOUNT_KEY` is set in your `.env` file
- Verify the JSON is valid and properly escaped
- Restart your backend server after adding the environment variable

### Issue: "Invalid registration token" error

**Solution**:

- The FCM token might be expired or invalid
- The backend will automatically remove invalid tokens from the database
- The Flutter app should request a new token and update it

### Issue: Notifications not received

**Check**:

1. Is the receiver online? (Notifications only sent when offline)
2. Is the FCM token valid and updated in the database?
3. Are there any errors in the backend console logs?
4. Is Firebase properly initialized? (Check startup logs)

## Security Notes

⚠️ **Important Security Considerations**:

1. **Never commit** your service account key to version control
2. Add `service-account-key.json` to your `.gitignore`
3. Store the key securely in your production environment variables
4. Use environment variables or secret management services (AWS Secrets Manager, etc.) in production

## Production Deployment

For production:

1. Set `FIREBASE_SERVICE_ACCOUNT_KEY` as an environment variable in your hosting platform
2. Ensure the JSON is properly escaped for your deployment platform
3. Test notifications in production before going live
4. Monitor error logs for invalid tokens and notification failures

## Additional Resources

- [Firebase Admin SDK Documentation](https://firebase.google.com/docs/admin/setup)
- [FCM Notification Best Practices](https://firebase.google.com/docs/cloud-messaging/concept-options)
- [Firebase Console](https://console.firebase.google.com/)

## Support

If you encounter issues:

1. Check backend console logs for error messages
2. Verify Firebase project settings
3. Ensure service account has proper permissions
4. Test with a simple notification first
