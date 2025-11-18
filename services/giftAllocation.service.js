const mongoose = require("mongoose");
const Gift = require("../models/Gift");

// Constants for current prices (these should ideally come from a price service)
const GOLD_PRICE_PER_GRAM = 11203.0; // ₹11,203 per gram
const TOP50_STOCK_NAV = 159.62; // ₹159.62 per unit

/**
 * Allocate/Convert a gift to gold or top 50 stocks
 * This is the core logic that can be used by both REST API and Socket handlers
 *
 * @param {Object} params
 * @param {string} params.giftId - Gift ID
 * @param {string} params.userId - User ID (receiver)
 * @param {string} params.allocationType - "gold" or "stock"
 * @param {Object} params.session - MongoDB session (optional, for transactions)
 * @returns {Object} Updated gift object
 */
async function allocateGift({
  giftId,
  userId,
  allocationType,
  session = null,
}) {
  // Validate allocation type
  if (!allocationType || !["gold", "stock"].includes(allocationType)) {
    throw new Error("allocationType must be either 'gold' or 'stock'");
  }

  // Find the gift - must belong to the user and not be already allotted
  // For self gifts, we allow auto-allocation even if status is pending
  const query = {
    _id: giftId,
    receiverId: userId,
    isAllotted: false,
    status: { $in: ["pending", "accepted"] },
  };

  const gift = session
    ? await Gift.findOne(query).session(session)
    : await Gift.findOne(query);

  if (!gift) {
    throw new Error(
      "Gift not found, already allotted, or you don't have permission to allocate it"
    );
  }

  // Check if gift is paid (if payment is required)
  // Skip payment check for self gifts as they should be auto-allotted
  if (!gift.isSelfGift && gift.isPaid === false && gift.status === "pending") {
    throw new Error("Gift payment is pending. Please complete payment first.");
  }

  // Step 1: Calculate CURRENT value of the original gift type using current market prices
  let currentValueInINR = gift.valueInINR; // Default to original value

  // If gift has currentPricePerUnit set, use it; otherwise use current market price
  let currentPriceOfOriginalType = gift.currentPricePerUnit;
  if (!currentPriceOfOriginalType) {
    // Use current market price for the original gift type
    if (gift.type === "gold") {
      currentPriceOfOriginalType = GOLD_PRICE_PER_GRAM;
    } else {
      currentPriceOfOriginalType = TOP50_STOCK_NAV;
    }
  }

  // Calculate current value: quantity × current price
  currentValueInINR = gift.quantity * currentPriceOfOriginalType;

  // Step 2: Store original value if not already stored
  if (!gift.originalValueInINR) {
    gift.originalValueInINR = gift.valueInINR;
  }

  // Step 3: Calculate conversion details and new allocation
  let conversionDetails = null;
  let convertedQuantity = gift.quantity;
  let conversionRate = 1;
  let newPricePerUnit = currentPriceOfOriginalType;
  let newValueInINR = currentValueInINR;

  // If the gift type is different from allocation type, we need to convert
  if (gift.type !== allocationType) {
    // Convert current value to new allocation type
    if (allocationType === "gold") {
      // Converting from stock to gold using CURRENT value
      convertedQuantity = currentValueInINR / GOLD_PRICE_PER_GRAM;
      newPricePerUnit = GOLD_PRICE_PER_GRAM;
      newValueInINR = currentValueInINR; // Value remains same, just different asset
      conversionRate = GOLD_PRICE_PER_GRAM / currentPriceOfOriginalType;
    } else {
      // Converting from gold to stock using CURRENT value
      convertedQuantity = currentValueInINR / TOP50_STOCK_NAV;
      newPricePerUnit = TOP50_STOCK_NAV;
      newValueInINR = currentValueInINR; // Value remains same, just different asset
      conversionRate = TOP50_STOCK_NAV / currentPriceOfOriginalType;
    }

    conversionDetails = {
      fromType: gift.type,
      toType: allocationType,
      conversionRate: conversionRate,
      convertedQuantity: convertedQuantity,
      fromPrice: currentPriceOfOriginalType,
      toPrice: newPricePerUnit,
      fromValue: currentValueInINR,
      toValue: newValueInINR,
    };
  } else {
    // Same type - no conversion needed, just allocation
    // But still update to current prices
    convertedQuantity = currentValueInINR / newPricePerUnit;
    conversionDetails = {
      fromType: gift.type,
      toType: allocationType,
      conversionRate: 1,
      convertedQuantity: convertedQuantity,
      fromPrice: currentPriceOfOriginalType,
      toPrice: newPricePerUnit,
      fromValue: currentValueInINR,
      toValue: newValueInINR,
    };
  }

  // Update gift with allocation details
  gift.isAllotted = true;
  gift.allottedAt = new Date();
  gift.convertedTo = allocationType;
  gift.status = "allotted";
  gift.conversionDetails = conversionDetails;
  gift.hiddenFromSender = false; // Keep visible to sender after allocation

  // Update to reflect the new allocation:
  // - Update quantity to converted quantity
  // - Update valueInINR to current value at allocation time
  // - Update currentPricePerUnit to new allocation type's current price
  gift.quantity = convertedQuantity;
  gift.allottedValueInINR = newValueInINR; // Store value at allocation time
  gift.valueInINR = newValueInINR; // Update current value
  gift.currentPricePerUnit = newPricePerUnit;

  // Update type and name if conversion happened
  if (gift.type !== allocationType) {
    gift.type = allocationType; // Update type to reflect new allocation
    gift.name = allocationType === "gold" ? "Gold 24K" : "Top50 Stock";
  }

  // Save the gift (with or without session)
  if (session) {
    await gift.save({ session });
  } else {
    await gift.save();
  }

  return gift;
}

module.exports = {
  allocateGift,
  GOLD_PRICE_PER_GRAM,
  TOP50_STOCK_NAV,
};
