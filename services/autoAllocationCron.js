const cron = require("node-cron");
const Gift = require("../models/Gift");
const AutoAllocationTask = require("../models/AutoAllocationTask");
const UserHistory = require("../models/UserHistory");
const { allocateGift } = require("./giftAllocation.service");

const RESCHEDULE_DELAY_MS = 60 * 60 * 1000; // Retry every hour if conditions aren't met

const startAutoAllocationCron = () => {
  cron.schedule("0 * * * *", async () => {
    try {
      console.log(
        "🔄 [Auto-Allocation Cron] Starting auto-allocation check..."
      );

      const now = new Date();

      const tasks = await AutoAllocationTask.find({
        isActive: true,
        scheduledAt: { $lte: now },
      }).populate({
        path: "giftId",
        populate: { path: "receiverId", select: "defaultGiftMode" },
      });

      console.log(
        `📊 [Auto-Allocation Cron] Found ${tasks.length} tasks to process`
      );

      let successCount = 0;
      let errorCount = 0;

      const markTaskCompleted = async (task, message = null) => {
        task.isActive = false;
        task.lastRunAt = new Date();
        task.runCount += 1;
        task.error = message;
        await task.save();
      };

      const rescheduleTask = async (task, message) => {
        task.lastRunAt = new Date();
        task.runCount += 1;
        task.error = message;
        task.scheduledAt = new Date(Date.now() + RESCHEDULE_DELAY_MS);
        await task.save();
      };

      for (const task of tasks) {
        try {
          const gift = task.giftId;

          if (!gift) {
            await markTaskCompleted(
              task,
              "Gift not found; marking task as complete."
            );
            continue;
          }

          if (gift.isSelfGift) {
            await markTaskCompleted(
              task,
              "Self gift requires no auto allocation."
            );
            continue;
          }

          if (gift.isAllotted) {
            await markTaskCompleted(
              task,
              "Gift already allotted before cron run."
            );
            continue;
          }

          if (!gift.receiverId) {
            await markTaskCompleted(task, "Gift receiver missing.");
            continue;
          }

          const receiver = gift.receiverId;
          if (!receiver.defaultGiftMode) {
            await rescheduleTask(
              task,
              "Receiver default gift mode missing. Will retry later."
            );
            continue;
          }

          const defaultMode = receiver.defaultGiftMode.toLowerCase();
          if (!["gold", "stock"].includes(defaultMode)) {
            await rescheduleTask(
              task,
              `Invalid default gift mode "${defaultMode}". Will retry later.`
            );
            continue;
          }

          const userId = task.userId?.toString() || receiver._id?.toString();
          if (!userId) {
            await markTaskCompleted(task, "User ID not available for task.");
            continue;
          }

          const userHistory = await UserHistory.getOrCreate(userId);

          const giftEntry = userHistory.giftHistory.find(
            (entry) =>
              entry.giftId && entry.giftId.toString() === gift._id.toString()
          );

          if (!giftEntry) {
            await markTaskCompleted(
              task,
              "Gift entry missing in user history. Marking task complete."
            );
            continue;
          }

          const totalAllocatedForGift = userHistory.allocationHistory
            .filter(
              (allocation) =>
                allocation.giftId &&
                allocation.giftId.toString() === gift._id.toString()
            )
            .reduce((sum, allocation) => sum + allocation.amount, 0);

          const remainingAmount = giftEntry.amount - totalAllocatedForGift;

          if (remainingAmount <= 0) {
            await markTaskCompleted(
              task,
              "Gift already fully allocated. Marking task complete."
            );
            continue;
          }

          if (userHistory.unallottedMoney < remainingAmount) {
            await rescheduleTask(
              task,
              `Insufficient unallotted money (available: ₹${userHistory.unallottedMoney}, required: ₹${remainingAmount}). Will retry later.`
            );
            continue;
          }

          await allocateGift({
            giftId: gift._id.toString(),
            userId: userId,
            allocationType: defaultMode,
            amount: remainingAmount,
          });

          await markTaskCompleted(task);

          console.log(
            `✅ [Auto-Allocation Cron] Gift ${gift._id}: Auto-allocated ₹${remainingAmount} to ${defaultMode}`
          );
          successCount++;
        } catch (error) {
          console.error(
            `❌ [Auto-Allocation Cron] Error processing task ${task._id}:`,
            error.message
          );
          errorCount++;
          await rescheduleTask(
            task,
            `Unexpected error: ${error.message}. Will retry later.`
          );
        }
      }

      console.log(
        `✅ [Auto-Allocation Cron] Completed: ${successCount} successful, ${errorCount} errors`
      );
    } catch (error) {
      console.error("❌ [Auto-Allocation Cron] Fatal error:", error.message);
    }
  });

  console.log("✅ [Auto-Allocation Cron] Cron job started (runs every hour)");
};

module.exports = { startAutoAllocationCron };
