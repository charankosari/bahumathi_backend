const admin = require("firebase-admin");
const Notification = require("../models/Notification");
const { emitToUser } = require("../sockets/socketEmitter");

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

const emitRealtimeNotification = (notificationDoc) => {
  if (!notificationDoc) return;
  try {
    const userId =
      notificationDoc.userId?.toString() ||
      (notificationDoc.userId && notificationDoc.userId._id
        ? notificationDoc.userId._id.toString()
        : null);
    if (!userId) return;
    const payload =
      typeof notificationDoc.toObject === "function"
        ? notificationDoc.toObject()
        : { ...notificationDoc };
    payload._id = payload._id?.toString() || notificationDoc._id?.toString();
    payload.userId = userId;
    emitToUser(userId, "notification:new", payload);
  } catch (error) {
    console.error(
      "❌ Failed to emit realtime notification:",
      error?.message || error
    );
  }
};

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
          // Tag to group notifications by sender
          tag: data.senderId || "message",
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
  // Format notification body as "sent a message" instead of showing message content
  if (messageType === "text") {
    notificationBody = "sent a message";
  } else if (messageType === "image") {
    notificationBody = "sent a photo";
  } else if (messageType === "voice") {
    notificationBody = "sent a voice message";
  } else if (messageType === "video") {
    notificationBody = "sent a video";
  } else {
    notificationBody = "sent a message";
  }

  // Format: Title = User name, Body = "sent a message"
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
        description: notificationBody, // "sent a message"
        senderId: senderData?._id,
        senderName: senderName,
        senderImage: senderData?.image,
        messageId: messageData._id,
        conversationId: messageData.conversationId,
        isSeen: false,
        isOpened: false,
      });
      console.log("✅ Notification saved to database for message");
      emitRealtimeNotification(savedNotification);
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

  // Check if this is a self-gift
  const isSelfGift =
    giftData?.isSelfGift ||
    (giftData?.senderId &&
      giftData?.receiverId &&
      String(giftData.senderId) === String(giftData.receiverId));

  // Format: Title = User name, Body = "sent you a gift" or "You sent yourself a gift"
  const notificationTitle = senderName;
  const notificationBody = isSelfGift
    ? "You sent yourself a gift"
    : "sent you a gift";
  const notificationType = isSelfGift ? "selfGift" : "gift";

  // Save notification to database first to get the notification ID
  let savedNotification = null;
  if (giftData?.receiverId) {
    try {
      savedNotification = await Notification.create({
        userId: giftData.receiverId,
        type: notificationType,
        title: senderName,
        description: notificationBody,
        senderId: senderData?._id,
        senderName: senderName,
        senderImage: senderData?.image,
        giftId: giftData._id,
        conversationId: giftData.conversationId,
        isSeen: false,
        isOpened: false,
      });
      console.log(`✅ Notification saved to database for ${notificationType}`);
      emitRealtimeNotification(savedNotification);
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
      type: notificationType,
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

  // Check if this is a self-gift
  const isSelfGift =
    giftData?.isSelfGift ||
    (giftData?.senderId &&
      giftData?.receiverId &&
      String(giftData.senderId) === String(giftData.receiverId));

  const messageType = messageData?.type || "text";
  let notificationBody = "";

  // Format notification body based on message type and self-gift status
  if (isSelfGift) {
    if (messageType === "text") {
      notificationBody = "You sent yourself a gift with message";
    } else if (messageType === "image") {
      notificationBody = "You sent yourself a gift with a photo";
    } else if (messageType === "voice") {
      notificationBody = "You sent yourself a gift with a voice message";
    } else if (messageType === "video") {
      notificationBody = "You sent yourself a gift with a video";
    } else {
      notificationBody = "You sent yourself a gift with message";
    }
  } else {
    // Format notification body as "sent you a gift with message" instead of showing message content
    if (messageType === "text") {
      notificationBody = "sent you a gift with message";
    } else if (messageType === "image") {
      notificationBody = "sent you a gift with a photo";
    } else if (messageType === "voice") {
      notificationBody = "sent you a gift with a voice message";
    } else if (messageType === "video") {
      notificationBody = "sent you a gift with a video";
    } else {
      notificationBody = "sent you a gift with message";
    }
  }

  // Format: Title = User name, Body = "sent you a gift with message"
  const notificationTitle = senderName;
  const notificationType = isSelfGift
    ? "selfGiftWithMessage"
    : "giftWithMessage";

  // Save notification to database first to get the notification ID
  let savedNotification = null;
  if (giftData?.receiverId) {
    try {
      savedNotification = await Notification.create({
        userId: giftData.receiverId,
        type: notificationType,
        title: senderName,
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
      console.log(`✅ Notification saved to database for ${notificationType}`);
      emitRealtimeNotification(savedNotification);
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
      type: notificationType,
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
