import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js";

export async function pushExpenses(data, config, context) {
    const pushQboEntity = httpsCallable(config.functions, 'pushQboEntity');

    for (const t of data) {
        if (!t.category) throw new Error("Missing category mapping in Expenses.");
        
        const vendorName = `${t.marketplace || 'Amazon'} Vendor`;
        const txnDate = t['date/time'] ? new Date(t['date/time']).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

        // FIX: Purchase logic expects positive numbers representing the expense paid
        const amt = parseFloat(t.total || 0) * -1;

        const payload = {
            "entityType": "Purchase",
            "realmId": config.realmId,
            "data": {
                "TxnDate": txnDate,
                "PaymentType": "Cash",
                "AccountRef": { "name": config.depositAccountName },
                "EntityRef": { "name": vendorName },
                "PrivateNote": t.lineItem,
                "Line": [
                    {
                        "Amount": amt,
                        "DetailType": "AccountBasedExpenseLineDetail",
                        "AccountBasedExpenseLineDetail": {
                            "AccountRef": { "name": t.category }
                        },
                        "Description": t.lineItem
                    }
                ]
            }
        };

        await pushQboEntity(payload);
    }
    context.showAlert(`Success! Created ${data.length} Expenses in QBO.`, "success");
}
