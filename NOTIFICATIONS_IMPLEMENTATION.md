# Real-Time Notifications Implementation Summary

## ✅ What Has Been Implemented

### 1. Backend Components

#### **Firebase Admin SDK Integration**

- ✅ Added `firebase-admin` package to `package.json`
- ✅ Created FCM notification service (`services/fcm.service.js`)
- ✅ Firebase Admin SDK initialization with environment variable support

#### **Database Changes**

- ✅ Added `fcmToken` field to User model for storing FCM tokens

#### **API Endpoints**

- ✅ Created `/api/v1/users/me/fcm-token` endpoint to update FCM tokens
- ✅ POST endpoint accepts `{ "fcmToken": "..." }` in request body

#### **Real-Time Notification Triggers**

- ✅ **Messages**: Push notifications sent when a message is sent and receiver is offline
- ✅ **Gifts**: Push notifications sent when a gift is sent and receiver is offline
- ✅ **Gifts with Messages**: Push notifications sent when a gift with message is sent and receiver is offline
- ✅ **Gift Payments**: Push notifications sent when Razorpay payment is captured for a gift

### 2. Notification Logic

The system intelligently handles notifications:

1. **Online Users**: If the receiver is online (connected via Socket.IO), they receive real-time updates via sockets. No push notification is sent.

2. **Offline Users**: If the receiver is offline, a push notification is sent to their device via FCM.

3. **Error Handling**: If a push notification fails, it doesn't affect the message/gift sending process. Errors are logged but don't block the main flow.

### 3. Notification Types

#### **Message Notifications**

- Title: Sender's name
- Body: Message content or media type indicator (📷 photo, 🎤 voice, 🎥 video)
- Data: Message ID, conversation ID, sender ID, message type

#### **Gift Notifications**

- Title: "🎁 New Gift Received!"
- Body: "SenderName sent you 💰 ₹X worth of Digital Gold" or "📈 ₹X worth of Top 50 Companies"
- Data: Gift ID, conversation ID, sender ID, gift type, amount

#### **Gift with Message Notifications**

- Title: "🎁 Gift with Message!"
- Body: "SenderName sent you 💰 ₹X worth of Digital Gold with a message"
- Data: Gift ID, message ID, conversation ID, sender ID, gift type, amount

## 📋 What You Need to Do Next

### Step 1: Install Dependencies

```bash
cd bahumathi_backend
npm install
```

This will install the `firebase-admin` package.

### Step 2: Set Up Firebase Service Account Key

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: **bahumati-b4255**
3. Go to **Project Settings** → **Service Accounts**
4. Click **Generate New Private Key**
5. Download the JSON file

### Step 3: Add to Environment Variables

Add the Firebase service account key to your `.env` file:

```env
FIREBASE_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"bahumati-b4255",...}'
```

**Important**:

- Wrap the entire JSON in single quotes
- Make sure it's a valid JSON string
- See `FIREBASE_SETUP.md` for detailed instructions

### Step 4: Test the Setup

1. Start your backend server:

```bash
npm start
```

2. Check the console logs. You should see:
   - ✅ `Firebase Admin SDK initialized successfully` (if correct)
   - ⚠️ `FIREBASE_SERVICE_ACCOUNT_KEY not set` (if not configured)

### Step 5: Flutter App Integration

In your Flutter app, you need to:

1. **Install Firebase packages**:

```yaml
dependencies:
  firebase_core: ^2.24.2
  firebase_messaging: ^14.7.9
```

2. **Initialize Firebase** in your Flutter app

3. **Get FCM token** and send it to the backend:

```dart
// Get FCM token
String? fcmToken = await FirebaseMessaging.instance.getToken();

// Send to backend
await apiService.updateFcmToken(fcmToken);
```

4. **Handle incoming notifications**:

   - Foreground notifications
   - Background notifications
   - Terminated app notifications

5. **Update FCM token** when it refreshes:

```dart
FirebaseMessaging.instance.onTokenRefresh.listen((newToken) {
  // Update token in backend
  apiService.updateFcmToken(newToken);
});
```

## 🔧 API Endpoint

### Update FCM Token

```http
POST /api/v1/users/me/fcm-token
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "fcmToken": "your-fcm-token-here"
}
```

**Response:**

```json
{
  "success": true,
  "message": "FCM token updated successfully"
}
```

## 📁 Files Modified/Created

### Created:

- `bahumathi_backend/services/fcm.service.js` - FCM notification service
- `bahumathi_backend/FIREBASE_SETUP.md` - Detailed Firebase setup guide
- `bahumathi_backend/NOTIFICATIONS_IMPLEMENTATION.md` - This file

### Modified:

- `bahumathi_backend/package.json` - Added `firebase-admin` dependency
- `bahumathi_backend/models/user.model.js` - Added `fcmToken` field
- `bahumathi_backend/controllers/user.controller.js` - Added `updateFcmToken` endpoint
- `bahumathi_backend/routes/user.routes.js` - Added FCM token route
- `bahumathi_backend/sockets/chatSocket.js` - Integrated push notifications for messages and gifts
- `bahumathi_backend/libs/payments/webhook.js` - Integrated push notifications for gift payments

## 🎯 How It Works

1. **User sends message/gift** → Backend processes it
2. **Backend checks if receiver is online**:
   - If **online**: Send via Socket.IO (real-time)
   - If **offline**: Send push notification via FCM
3. **Push notification sent** → User receives notification on their device
4. **User taps notification** → App opens to the conversation/gift

## 🔒 Security Notes

- FCM tokens are stored securely in the database
- Invalid tokens are automatically detected and can be removed
- Service account key should never be committed to version control
- Use environment variables for sensitive data

## 📚 Additional Resources

- See `FIREBASE_SETUP.md` for detailed Firebase setup instructions
- [Firebase Admin SDK Docs](https://firebase.google.com/docs/admin/setup)
- [FCM Flutter Plugin](https://pub.dev/packages/firebase_messaging)

## 🐛 Troubleshooting

### Notifications not working?

1. Check if Firebase is initialized (check backend logs)
2. Verify FCM token is saved in database
3. Check if receiver is online (notifications only sent when offline)
4. Verify service account key is correct
5. Check backend error logs for notification failures

### Invalid token errors?

- FCM tokens can expire or become invalid
- Backend will log these errors
- Flutter app should request new token and update it

## ✨ Next Steps

1. ✅ Backend is ready - just add Firebase service account key
2. ⏳ Flutter app needs FCM integration (get token, send to backend, handle notifications)
3. ⏳ Test notifications in development
4. ⏳ Deploy to production

---

**Status**: Backend implementation complete! 🎉

You just need to:

1. Add Firebase service account key to `.env`
2. Install dependencies (`npm install`)
3. Integrate FCM in your Flutter app
