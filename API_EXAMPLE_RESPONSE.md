# Example API Response: Get User Transactions

## Endpoint
`GET /api/v1/admin/users/:userId/transactions`

## Example Response

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "507f1f77bcf86cd799439011",
      "fullName": "John Doe",
      "number": "9876543210",
      "image": "https://example.com/profile.jpg"
    },
    "summary": {
      "totalGiftsSent": 50000,
      "totalGiftsReceived": 75000,
      "totalAllocated": 45000,
      "totalWithdrawn": 15000,
      "totalPendingWithdrawals": 5000,
      "netBalance": 10000,
      "totalEventsCreated": 3,
      "totalEventGiftsAmount": 100000,
      "totalEventWithdrawals": 30000
    },
    "transactions": {
      "giftsSent": 5,
      "giftsReceived": 8,
      "allocations": 12,
      "total": 25,
      "list": [
        {
          "type": "gift_received",
          "transactionId": "BAHU20240117123456ABC",
          "amount": 10000,
          "giftType": "gold",
          "giftName": "Gold 24K",
          "quantity": 0.892,
          "status": "allotted",
          "isAllotted": true,
          "sender": {
            "id": "507f1f77bcf86cd799439012",
            "name": "Jane Smith",
            "image": "https://example.com/jane.jpg",
            "number": "9876543211"
          },
          "event": null,
          "createdAt": "2024-01-17T10:30:00.000Z",
          "isSelfGift": false
        },
        {
          "type": "gift_sent",
          "transactionId": "BAHU20240116123456XYZ",
          "amount": 5000,
          "giftType": "stock",
          "giftName": "Top50 Stock",
          "quantity": 31.33,
          "status": "accepted",
          "receiver": {
            "id": "507f1f77bcf86cd799439013",
            "name": "Bob Johnson",
            "image": "https://example.com/bob.jpg",
            "number": "9876543212"
          },
          "event": {
            "id": "507f1f77bcf86cd799439020",
            "title": "Wedding Celebration",
            "eventLink": "event-abc123def456"
          },
          "createdAt": "2024-01-16T14:20:00.000Z",
          "isSelfGift": false
        },
        {
          "type": "allocation",
          "amount": 5000,
          "allocationType": "gold",
          "quantity": 0.446,
          "pricePerUnit": 11203,
          "allocatedAt": "2024-01-15T09:15:00.000Z",
          "giftId": {
            "_id": "507f1f77bcf86cd799439014",
            "valueInINR": 10000,
            "type": "gold",
            "name": "Gold 24K"
          },
          "conversionDetails": null
        },
        {
          "type": "gift_received",
          "transactionId": "BAHU20240115123456DEF",
          "amount": 15000,
          "giftType": "gold",
          "giftName": "Gold 24K",
          "quantity": 1.338,
          "status": "allotted",
          "isAllotted": true,
          "sender": {
            "id": "507f1f77bcf86cd799439015",
            "name": "Alice Williams",
            "image": "https://example.com/alice.jpg",
            "number": "9876543213"
          },
          "event": {
            "id": "507f1f77bcf86cd799439020",
            "title": "Wedding Celebration",
            "eventLink": "event-abc123def456"
          },
          "createdAt": "2024-01-15T11:45:00.000Z",
          "isSelfGift": false
        }
      ]
    },
    "withdrawals": {
      "total": 4,
      "approved": 2,
      "pending": 1,
      "rejected": 1,
      "list": [
        {
          "_id": "507f1f77bcf86cd799439030",
          "eventId": {
            "_id": "507f1f77bcf86cd799439020",
            "title": "Wedding Celebration",
            "eventLink": "event-abc123def456",
            "eventStartDate": "2024-01-17T00:00:00.000Z",
            "eventEndDate": "2024-01-19T23:59:59.000Z"
          },
          "userId": "507f1f77bcf86cd799439011",
          "amount": 15000,
          "percentage": 30,
          "totalGiftsAmount": 50000,
          "status": "approved",
          "moneyState": "withdrawn",
          "approvedBy": {
            "_id": "507f1f77bcf86cd799439040",
            "fullName": "Admin User"
          },
          "approvedAt": "2024-01-20T10:00:00.000Z",
          "rejectedBy": null,
          "rejectedAt": null,
          "rejectionReason": null,
          "createdAt": "2024-01-19T15:30:00.000Z",
          "updatedAt": "2024-01-20T10:00:00.000Z"
        },
        {
          "_id": "507f1f77bcf86cd799439031",
          "eventId": {
            "_id": "507f1f77bcf86cd799439021",
            "title": "Birthday Party",
            "eventLink": "event-xyz789ghi012",
            "eventStartDate": "2024-01-10T00:00:00.000Z",
            "eventEndDate": "2024-01-12T23:59:59.000Z"
          },
          "userId": "507f1f77bcf86cd799439011",
          "amount": 5000,
          "percentage": 30,
          "totalGiftsAmount": 20000,
          "status": "pending",
          "moneyState": "holding",
          "approvedBy": null,
          "approvedAt": null,
          "rejectedBy": null,
          "rejectedAt": null,
          "rejectionReason": null,
          "createdAt": "2024-01-13T09:00:00.000Z",
          "updatedAt": "2024-01-13T09:00:00.000Z"
        },
        {
          "_id": "507f1f77bcf86cd799439032",
          "eventId": {
            "_id": "507f1f77bcf86cd799439022",
            "title": "Anniversary",
            "eventLink": "event-mno345pqr678",
            "eventStartDate": "2024-01-05T00:00:00.000Z",
            "eventEndDate": "2024-01-07T23:59:59.000Z"
          },
          "userId": "507f1f77bcf86cd799439011",
          "amount": 3000,
          "percentage": 30,
          "totalGiftsAmount": 10000,
          "status": "rejected",
          "moneyState": "alloting",
          "approvedBy": null,
          "approvedAt": null,
          "rejectedBy": {
            "_id": "507f1f77bcf86cd799439040",
            "fullName": "Admin User"
          },
          "rejectedAt": "2024-01-08T14:20:00.000Z",
          "rejectionReason": "Insufficient documentation",
          "createdAt": "2024-01-08T10:00:00.000Z",
          "updatedAt": "2024-01-08T14:20:00.000Z"
        }
      ]
    },
    "events": {
      "total": 3,
      "active": 1,
      "ended": 2,
      "cancelled": 0,
      "list": [
        {
          "id": "507f1f77bcf86cd799439020",
          "title": "Wedding Celebration",
          "description": "My wedding celebration event",
          "image": "https://example.com/wedding.jpg",
          "eventStartDate": "2024-01-17T00:00:00.000Z",
          "eventEndDate": "2024-01-19T23:59:59.000Z",
          "eventLink": "event-abc123def456",
          "status": "ended",
          "withdrawalPercentage": 30,
          "stats": {
            "totalGiftsReceived": 10,
            "totalGiftsAmount": 50000,
            "maxWithdrawable": 15000,
            "totalWithdrawn": 15000,
            "totalPendingWithdrawals": 0,
            "availableForWithdrawal": 0
          },
          "createdAt": "2024-01-10T08:00:00.000Z",
          "updatedAt": "2024-01-20T12:00:00.000Z"
        },
        {
          "id": "507f1f77bcf86cd799439021",
          "title": "Birthday Party",
          "description": "25th birthday celebration",
          "image": "https://example.com/birthday.jpg",
          "eventStartDate": "2024-01-10T00:00:00.000Z",
          "eventEndDate": "2024-01-12T23:59:59.000Z",
          "eventLink": "event-xyz789ghi012",
          "status": "ended",
          "withdrawalPercentage": 30,
          "stats": {
            "totalGiftsReceived": 5,
            "totalGiftsAmount": 20000,
            "maxWithdrawable": 6000,
            "totalWithdrawn": 0,
            "totalPendingWithdrawals": 5000,
            "availableForWithdrawal": 1000
          },
          "createdAt": "2024-01-05T10:00:00.000Z",
          "updatedAt": "2024-01-13T09:00:00.000Z"
        },
        {
          "id": "507f1f77bcf86cd799439022",
          "title": "New Year Celebration",
          "description": "New Year 2024 party",
          "image": null,
          "eventStartDate": "2024-12-31T00:00:00.000Z",
          "eventEndDate": "2025-01-02T23:59:59.000Z",
          "eventLink": "event-mno345pqr678",
          "status": "active",
          "withdrawalPercentage": 30,
          "stats": {
            "totalGiftsReceived": 8,
            "totalGiftsAmount": 30000,
            "maxWithdrawable": 9000,
            "totalWithdrawn": 0,
            "totalPendingWithdrawals": 0,
            "availableForWithdrawal": 9000
          },
          "createdAt": "2024-12-25T08:00:00.000Z",
          "updatedAt": "2024-12-31T10:00:00.000Z"
        }
      ]
    }
  }
}
```

## Response Structure Breakdown

### 1. User Information
- Basic user details (id, name, number, image)

### 2. Summary
- Financial totals and balances
- Event-related totals

### 3. Transactions List
- **gift_sent**: Gifts sent by the user
- **gift_received**: Gifts received by the user
- **allocation**: Money allocations to gold/stock

### 4. Withdrawals List
- All withdrawal requests with:
  - Status (pending/approved/rejected)
  - Event details
  - Approval/rejection information

### 5. Events List
- All events created by the user with:
  - Event details
  - Statistics (gifts, amounts, withdrawals)
  - Status breakdown

## Notes
- All dates are in ISO 8601 format
- Amounts are in INR (Indian Rupees)
- Transaction list is sorted by date (newest first)
- Events list is sorted by creation date (newest first)

