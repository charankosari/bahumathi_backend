const admin = require("firebase-admin");

// Initialize Firebase Admin SDK
// Make sure to set FIREBASE_SERVICE_ACCOUNT_KEY in your .env file
// This should be a JSON string of your Firebase service account key
let firebaseInitialized = false;

const initializeFirebase = () => {
  if (firebaseInitialized) {
    return;
  }

  try {
    const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

    if (!serviceAccountKey) {
      console.warn(
        "⚠️ FIREBASE_SERVICE_ACCOUNT_KEY not set. Push notifications will be disabled."
      );
      return;
    }

    // Parse the service account key from environment variable
    const serviceAccount = JSON.parse(serviceAccountKey);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    firebaseInitialized = true;
    console.log("✅ Firebase Admin SDK initialized successfully");
  } catch (error) {
    console.error("❌ Failed to initialize Firebase Admin SDK:", error.message);
    console.error(
      "⚠️ Push notifications will be disabled. Please check your FIREBASE_SERVICE_ACCOUNT_KEY."
    );
  }
};

// Initialize Firebase on module load
initializeFirebase();

/**
 * Send push notification to a single device
 * @param {string} fcmToken - FCM token of the recipient
 * @param {Object} notification - Notification payload
 * @param {Object} data - Additional data payload
 * @returns {Promise<Object>}
 */
const sendPushNotification = async (fcmToken, notification, data = {}) => {
  if (!firebaseInitialized || !fcmToken) {
    console.warn(
      "⚠️ Cannot send push notification: Firebase not initialized or token missing"
    );
    return {
      success: false,
      error: "Firebase not initialized or token missing",
    };
  }

  try {
    const message = {
      token: fcmToken,
      notification: {
        title: notification.title || "Bahumati",
        body: notification.body || "You have a new notification",
        ...notification,
      },
      data: {
        ...data,
        // Ensure all data values are strings (FCM requirement)
        ...Object.keys(data).reduce((acc, key) => {
          acc[key] = String(data[key]);
          return acc;
        }, {}),
      },
      android: {
        priority: "high",
        notification: {
          sound: "default",
          channelId: "bahumati_notifications",
          priority: "high",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: 1,
          },
        },
      },
    };

    const response = await admin.messaging().send(message);
    console.log("✅ Push notification sent successfully:", response);
    return { success: true, messageId: response };
  } catch (error) {
    console.error("❌ Error sending push notification:", error.message);

    // Handle invalid token errors
    if (
      error.code === "messaging/invalid-registration-token" ||
      error.code === "messaging/registration-token-not-registered"
    ) {
      console.warn(
        "⚠️ Invalid FCM token detected. Token should be removed from database."
      );
      return {
        success: false,
        error: "Invalid token",
        shouldRemoveToken: true,
      };
    }

    return { success: false, error: error.message };
  }
};

/**
 * Send push notification to multiple devices
 * @param {string[]} fcmTokens - Array of FCM tokens
 * @param {Object} notification - Notification payload
 * @param {Object} data - Additional data payload
 * @returns {Promise<Object>}
 */
const sendMulticastPushNotification = async (
  fcmTokens,
  notification,
  data = {}
) => {
  if (!firebaseInitialized || !fcmTokens || fcmTokens.length === 0) {
    console.warn(
      "⚠️ Cannot send multicast push notification: Firebase not initialized or tokens missing"
    );
    return {
      success: false,
      error: "Firebase not initialized or tokens missing",
    };
  }

  try {
    const message = {
      notification: {
        title: notification.title || "Bahumati",
        body: notification.body || "You have a new notification",
        ...notification,
      },
      data: {
        ...data,
        // Ensure all data values are strings (FCM requirement)
        ...Object.keys(data).reduce((acc, key) => {
          acc[key] = String(data[key]);
          return acc;
        }, {}),
      },
      android: {
        priority: "high",
        notification: {
          sound: "default",
          channelId: "bahumati_notifications",
          priority: "high",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: 1,
          },
        },
      },
      tokens: fcmTokens,
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(
      `✅ Multicast push notification sent: ${response.successCount} successful, ${response.failureCount} failed`
    );

    // Handle invalid tokens
    if (response.failureCount > 0) {
      const invalidTokens = [];
      response.responses.forEach((resp, idx) => {
        if (
          !resp.success &&
          (resp.error?.code === "messaging/invalid-registration-token" ||
            resp.error?.code === "messaging/registration-token-not-registered")
        ) {
          invalidTokens.push(fcmTokens[idx]);
        }
      });

      if (invalidTokens.length > 0) {
        console.warn(
          `⚠️ Found ${invalidTokens.length} invalid FCM tokens that should be removed`
        );
        return {
          success: response.successCount > 0,
          invalidTokens,
          successCount: response.successCount,
          failureCount: response.failureCount,
        };
      }
    }

    return {
      success: response.successCount > 0,
      successCount: response.successCount,
      failureCount: response.failureCount,
    };
  } catch (error) {
    console.error(
      "❌ Error sending multicast push notification:",
      error.message
    );
    return { success: false, error: error.message };
  }
};

/**
 * Send notification for a new message
 * @param {string} fcmToken - FCM token of the recipient
 * @param {Object} messageData - Message data
 * @param {Object} senderData - Sender user data
 * @returns {Promise<Object>}
 */
const sendMessageNotification = async (
  fcmToken,
  messageData,
  senderData,
  unencryptedContent = null
) => {
  const senderName = senderData?.fullName || "Someone";
  const messageType = messageData?.type || "text";

  let notificationBody = "";
  // Use unencrypted content if provided, otherwise try to use content from messageData
  // For text messages, prefer unencrypted content
  if (messageType === "text") {
    notificationBody =
      unencryptedContent || messageData?.content || "Sent you a message";
    // Limit message length to 100 characters for notification
    if (notificationBody.length > 100) {
      notificationBody = notificationBody.substring(0, 97) + "...";
    }
  } else if (messageType === "image") {
    notificationBody = "📷 Sent you a photo";
  } else if (messageType === "voice") {
    notificationBody = "🎤 Sent you a voice message";
  } else if (messageType === "video") {
    notificationBody = "🎥 Sent you a video";
  } else {
    notificationBody = "Sent you a message";
  }

  return await sendPushNotification(
    fcmToken,
    {
      title: senderName,
      body: notificationBody,
    },
    {
      type: "message",
      messageId: messageData?._id?.toString() || "",
      conversationId: messageData?.conversationId?.toString() || "",
      senderId: senderData?._id?.toString() || "",
      senderName: senderName,
      senderImage: senderData?.image?.toString() || "",
      messageType: messageType,
    }
  );
};

/**
 * Send notification for a new gift
 * @param {string} fcmToken - FCM token of the recipient
 * @param {Object} giftData - Gift data
 * @param {Object} senderData - Sender user data
 * @returns {Promise<Object>}
 */
const sendGiftNotification = async (fcmToken, giftData, senderData) => {
  const senderName = senderData?.fullName || "Someone";
  const giftType = giftData?.type || "gold";
  const amount = giftData?.valueInINR || 0;

  const giftTypeName = giftType === "gold" ? "gold" : "stocks";

  // Shortened notification: "A gift sent by [username] in gold/stocks worth ₹2500"
  const notificationBody = `A gift sent by ${senderName} in ${giftTypeName} worth ₹${amount.toLocaleString()}`;

  return await sendPushNotification(
    fcmToken,
    {
      title: "🎁 New Gift Received!",
      body: notificationBody,
    },
    {
      type: "gift",
      giftId: giftData?._id?.toString() || "",
      conversationId: giftData?.conversationId?.toString() || "",
      senderId: senderData?._id?.toString() || "",
      senderName: senderName,
      senderImage: senderData?.image?.toString() || "",
      giftType: giftType,
      amount: amount.toString(),
    }
  );
};

/**
 * Send notification for a gift with message
 * @param {string} fcmToken - FCM token of the recipient
 * @param {Object} giftData - Gift data
 * @param {Object} messageData - Message data
 * @param {Object} senderData - Sender user data
 * @returns {Promise<Object>}
 */
const sendGiftWithMessageNotification = async (
  fcmToken,
  giftData,
  messageData,
  senderData,
  unencryptedContent = null
) => {
  const senderName = senderData?.fullName || "Someone";
  const giftType = giftData?.type || "gold";
  const amount = giftData?.valueInINR || 0;

  const giftTypeName = giftType === "gold" ? "gold" : "stocks";

  // Shortened notification: "A gift sent by [username] in gold/stocks worth ₹2500"
  const notificationBody = `A gift sent by ${senderName} in ${giftTypeName} worth ₹${amount.toLocaleString()}`;

  return await sendPushNotification(
    fcmToken,
    {
      title: "🎁 Gift with Message!",
      body: notificationBody,
    },
    {
      type: "giftWithMessage",
      giftId: giftData?._id?.toString() || "",
      messageId: messageData?._id?.toString() || "",
      conversationId: giftData?.conversationId?.toString() || "",
      senderId: senderData?._id?.toString() || "",
      senderName: senderName,
      senderImage: senderData?.image?.toString() || "",
      giftType: giftType,
      amount: amount.toString(),
    }
  );
};

module.exports = {
  sendPushNotification,
  sendMulticastPushNotification,
  sendMessageNotification,
  sendGiftNotification,
  sendGiftWithMessageNotification,
  initializeFirebase,
};
