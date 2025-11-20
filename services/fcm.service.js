const admin = require("firebase-admin");
const Notification = require("../models/Notification");

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
          // Add image for rich notifications (user DP)
          imageUrl: data.senderImage || undefined,
          // Add app icon and name
          icon: "ic_notification", // App icon name
          color: "#7B2CBF", // App primary color (purple)
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: 1,
            // Add app name and icon for iOS
            alert: {
              title: notification.title || "Bahumati",
              body: notification.body || "You have a new notification",
            },
          },
          // Add image for rich notifications (user DP)
          fcm_options: {
            image: data.senderImage || undefined,
          },
        },
      },
      // Add web push notification config
      webpush: {
        notification: {
          title: notification.title || "Bahumati",
          body: notification.body || "You have a new notification",
          icon: data.senderImage || undefined,
          badge: "/icon-192x192.png",
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
  const senderImage = senderData?.image?.toString() || "";

  let notificationBody = "";
  // Use unencrypted content if provided, otherwise try to use content from messageData
  // For text messages, prefer unencrypted content
  if (messageType === "text") {
    notificationBody =
      unencryptedContent || messageData?.content || "sent you a message";
    // Limit message length to 100 characters for notification
    if (notificationBody.length > 100) {
      notificationBody = notificationBody.substring(0, 97) + "...";
    }
  } else if (messageType === "image") {
    notificationBody = "📷 sent you a photo";
  } else if (messageType === "voice") {
    notificationBody = "🎤 sent you a voice message";
  } else if (messageType === "video") {
    notificationBody = "🎥 sent you a video";
  } else {
    notificationBody = "sent you a message";
  }

  // Format: "Username: message content" for better display
  const notificationTitle = senderName;
  const notificationBodyFormatted = notificationBody;

  // Save notification to database first to get the notification ID
  let savedNotification = null;
  if (messageData?.receiverId) {
    try {
      savedNotification = await Notification.create({
        userId: messageData.receiverId,
        type: "message",
        title: senderName,
        description: notificationBody,
        senderId: senderData?._id,
        senderName: senderName,
        senderImage: senderData?.image,
        messageId: messageData._id,
        conversationId: messageData.conversationId,
        isSeen: false,
        isOpened: false,
      });
      console.log("✅ Notification saved to database for message");
    } catch (error) {
      console.error("❌ Error saving notification to database:", error.message);
    }
  }

  const notificationResult = await sendPushNotification(
    fcmToken,
    {
      title: notificationTitle,
      body: notificationBodyFormatted,
    },
    {
      type: "message",
      notificationId: savedNotification?._id?.toString() || "",
      messageId: messageData?._id?.toString() || "",
      conversationId: messageData?.conversationId?.toString() || "",
      senderId: senderData?._id?.toString() || "",
      senderName: senderName,
      senderImage: senderImage,
      messageType: messageType,
      messageContent: notificationBody, // Include message content in data
      appName: "Bahumati", // App name
    }
  );

  return notificationResult;
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
  const senderImage = senderData?.image?.toString() || "";

  const giftTypeName = giftType === "gold" ? "gold" : "stocks";

  // Format: "[username] sent you a gift" for better display
  const notificationTitle = senderName;
  const notificationBody = `sent you a gift worth ₹${amount.toLocaleString()}`;

  // Save notification to database first to get the notification ID
  let savedNotification = null;
  if (giftData?.receiverId) {
    try {
      savedNotification = await Notification.create({
        userId: giftData.receiverId,
        type: "gift",
        title: "🎁 New Gift Received!",
        description: notificationBody,
        senderId: senderData?._id,
        senderName: senderName,
        senderImage: senderData?.image,
        giftId: giftData._id,
        conversationId: giftData.conversationId,
        isSeen: false,
        isOpened: false,
      });
      console.log("✅ Notification saved to database for gift");
    } catch (error) {
      console.error("❌ Error saving notification to database:", error.message);
    }
  }

  const notificationResult = await sendPushNotification(
    fcmToken,
    {
      title: notificationTitle,
      body: notificationBody,
    },
    {
      type: "gift",
      notificationId: savedNotification?._id?.toString() || "",
      giftId: giftData?._id?.toString() || "",
      conversationId: giftData?.conversationId?.toString() || "",
      senderId: senderData?._id?.toString() || "",
      senderName: senderName,
      senderImage: senderImage,
      giftType: giftType,
      amount: amount.toString(),
      appName: "Bahumati", // App name
    }
  );

  return notificationResult;
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
  const senderImage = senderData?.image?.toString() || "";

  const messageType = messageData?.type || "text";
  let messageContent = "";

  // Get message content for notification
  if (messageType === "text") {
    messageContent =
      unencryptedContent ||
      messageData?.content ||
      "sent you a gift with message";
    // Limit message length to 80 characters for notification
    if (messageContent.length > 80) {
      messageContent = messageContent.substring(0, 77) + "...";
    }
  } else if (messageType === "image") {
    messageContent = "📷 sent you a gift with a photo";
  } else if (messageType === "voice") {
    messageContent = "🎤 sent you a gift with a voice message";
  } else if (messageType === "video") {
    messageContent = "🎥 sent you a gift with a video";
  } else {
    messageContent = "sent you a gift with message";
  }

  // Format: "[username]: message content" for better display
  const notificationTitle = senderName;
  const notificationBody = messageContent;

  // Save notification to database first to get the notification ID
  let savedNotification = null;
  if (giftData?.receiverId) {
    try {
      savedNotification = await Notification.create({
        userId: giftData.receiverId,
        type: "giftWithMessage",
        title: "🎁 Gift with Message!",
        description: notificationBody,
        senderId: senderData?._id,
        senderName: senderName,
        senderImage: senderData?.image,
        giftId: giftData._id,
        messageId: messageData?._id,
        conversationId: giftData.conversationId,
        isSeen: false,
        isOpened: false,
      });
      console.log("✅ Notification saved to database for gift with message");
    } catch (error) {
      console.error("❌ Error saving notification to database:", error.message);
    }
  }

  const notificationResult = await sendPushNotification(
    fcmToken,
    {
      title: notificationTitle,
      body: notificationBody,
    },
    {
      type: "giftWithMessage",
      notificationId: savedNotification?._id?.toString() || "",
      giftId: giftData?._id?.toString() || "",
      messageId: messageData?._id?.toString() || "",
      conversationId: giftData?.conversationId?.toString() || "",
      senderId: senderData?._id?.toString() || "",
      senderName: senderName,
      senderImage: senderImage,
      giftType: giftType,
      amount: amount.toString(),
      messageType: messageType,
      messageContent: messageContent, // Include message content in data
      appName: "Bahumati", // App name
    }
  );

  return notificationResult;
};

module.exports = {
  sendPushNotification,
  sendMulticastPushNotification,
  sendMessageNotification,
  sendGiftNotification,
  sendGiftWithMessageNotification,
  initializeFirebase,
};
