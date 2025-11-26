# Event System Documentation

## Overview

The event system allows users to create events (like weddings, birthdays, etc.) where others can send gifts during a specific date range. Event creators can withdraw a percentage (default 30%) of the gifts received, subject to admin approval.

## Models

### Event Model

- `creatorId`: User who created the event
- `title`: Event title
- `description`: Event description (can be points or anything)
- `image`: Optional event image URL
- `eventStartDate`: When the event starts
- `eventEndDate`: When the event ends
- `eventLink`: Unique link for sharing (auto-generated)
- `status`: "active", "ended", or "cancelled"
- `totalGiftsReceived`: Count of gifts received
- `totalGiftsAmount`: Total amount of gifts in INR
- `withdrawalPercentage`: Percentage that can be withdrawn (default 30%)

### WithdrawalRequest Model

- `eventId`: Associated event
- `userId`: User requesting withdrawal (event creator)
- `amount`: Amount requested
- `percentage`: Withdrawal percentage used
- `totalGiftsAmount`: Total gifts amount at time of request
- `status`: "pending", "approved", or "rejected"
- `moneyState`: "holding", "withdrawn", or "alloting"
- `approvedBy`: Admin who approved (if approved)
- `rejectedBy`: Admin who rejected (if rejected)
- `rejectionReason`: Reason for rejection (if rejected)

### Updated Models

- **Gift**: Added `eventId` field (optional) to link gifts to events
- **UserHistory**: Added `holdingMoney` field to track money in withdrawal requests

## API Endpoints

### Event Endpoints

#### Create Event

```
POST /api/v1/events
Authorization: Bearer <token>
Body: {
  "title": "Wedding",
  "description": "My wedding celebration",
  "image": "https://example.com/image.jpg", // optional
  "eventStartDate": "2024-01-17T00:00:00Z",
  "eventEndDate": "2024-01-19T23:59:59Z",
  "withdrawalPercentage": 30 // optional, default 30
}
```

#### Get My Events

```
GET /api/v1/events
Authorization: Bearer <token>
```

#### Get Event by Link (Public - No Auth Required)

```
GET /api/v1/events/link/:eventLink
```

#### Get Event by ID

```
GET /api/v1/events/:eventId
Authorization: Bearer <token>
```

#### Update Event

```
PATCH /api/v1/events/:eventId
Authorization: Bearer <token>
Body: {
  "title": "Updated Title", // optional
  "description": "Updated description", // optional
  "image": "https://example.com/new-image.jpg", // optional
  "eventStartDate": "2024-01-18T00:00:00Z", // optional
  "eventEndDate": "2024-01-20T23:59:59Z", // optional
  "withdrawalPercentage": 40 // optional
}
```

#### Delete Event

```
DELETE /api/v1/events/:eventId
Authorization: Bearer <token>
Note: Cannot delete events with associated gifts
```

### Withdrawal Endpoints

#### Create Withdrawal Request

```
POST /api/v1/withdrawals
Authorization: Bearer <token>
Body: {
  "eventId": "event_id_here",
  "amount": 5000
}
```

#### Get My Withdrawal Requests

```
GET /api/v1/withdrawals
Authorization: Bearer <token>
```

#### Get Event Withdrawal Requests

```
GET /api/v1/withdrawals/event/:eventId
Authorization: Bearer <token>
Note: Only event creator can access
```

#### Get All Withdrawal Requests (Admin Only)

```
GET /api/v1/withdrawals/all?status=pending
Authorization: Bearer <admin_token>
Query Params: status (optional) - filter by status
```

#### Approve Withdrawal Request (Admin Only)

```
PATCH /api/v1/withdrawals/:requestId/approve
Authorization: Bearer <admin_token>
```

#### Reject Withdrawal Request (Admin Only)

```
PATCH /api/v1/withdrawals/:requestId/reject
Authorization: Bearer <admin_token>
Body: {
  "rejectionReason": "Insufficient documentation" // optional
}
```

## Gift Flow with Events

### Sending Gifts to Events

When sending a gift via socket (`sendGift` event), include `eventId` in the `giftData`:

```javascript
{
  receiverId: "event_creator_id",
  giftData: {
    type: "gold",
    name: "Gold 24K",
    valueInINR: 1000,
    quantity: 0.089,
    pricePerUnitAtGift: 11203,
    eventId: "event_id_here" // Add this field
  }
}
```

**Validation:**

- Event must exist and be active
- Current date must be between event start and end dates
- Receiver must be the event creator
- Event stats are automatically updated

## Money States

1. **Unallotted**: Money received from gifts, not yet allocated to gold/stock
2. **Holding**: Money in a pending withdrawal request (moved from unallotted)
3. **Withdrawn**: Money approved for withdrawal (removed from holding)
4. **Alloting**: Money rejected from withdrawal (moved back to unallotted)

## Withdrawal Flow

1. **Create Request**: User creates withdrawal request

   - Money moves from `unallottedMoney` to `holdingMoney`
   - Request status: "pending"
   - Money state: "holding"

2. **Admin Approval**: Admin approves request

   - Money is removed from `holdingMoney` (withdrawn)
   - Request status: "approved"
   - Money state: "withdrawn"

3. **Admin Rejection**: Admin rejects request
   - Money moves from `holdingMoney` back to `unallottedMoney`
   - Request status: "rejected"
   - Money state: "alloting"

## Withdrawal Limits

- Maximum withdrawable = (Total Gifts Amount × Withdrawal Percentage) / 100
- Available for withdrawal = Maximum withdrawable - Sum of pending requests
- User must have sufficient `unallottedMoney` to create a request

## Example Flow

1. User creates event: "Wedding" (Jan 17-19, 30% withdrawal)
2. Event link generated: `event-abc123def456`
3. User shares link with friends
4. Friends send gifts during event period (Jan 17-19)
5. Total gifts: ₹10,000
6. User can withdraw: ₹3,000 (30% of ₹10,000)
7. User creates withdrawal request for ₹2,000
8. Money moves to holding state
9. Admin approves request
10. ₹2,000 is withdrawn, remaining ₹1,000 still available

## Notes

- Events cannot be deleted if they have associated gifts
- Gifts can only be sent to events during the event date range
- Only the event creator can create withdrawal requests
- Only admins can approve/reject withdrawal requests
- Event stats (total gifts, total amount) are automatically updated
