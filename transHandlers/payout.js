import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js";

export async function pushPayouts(data, config, context) {
    const pushQboEntity = httpsCallable(config.functions, 'pushQboEntity');

    for (const t of data) {
        if (!t.category) throw new Error("Missing category mapping in Payouts.");
        
        const vendorName = `${t.marketplace || 'Amazon'} Vendor`;
        const txnDate = t['date/time'] ? new Date(t['date/time']).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

        const payload = {
            "entityType": "Purchase",
            "realmId": config.realmId,
            "data": {
                "TxnDate": txnDate,
                "PaymentType": "Cash",
                "AccountRef": { "name": config.depositAccountName }, // Clearing Account
                "EntityRef": { "name": vendorName },
                "PrivateNote": `Transfer ID: ${t['settlement id'] || 'N/A'}`,
                "Line": [
                    {
                        "Amount": Math.abs(parseFloat(t.total)),
                        "DetailType": "AccountBasedExpenseLineDetail",
                        "AccountBasedExpenseLineDetail": {
                            "AccountRef": { "name": t.category } // The real bank account
                        },
                        "Description": t.lineItem
                    }
                ]
            }
        };

        await pushQboEntity(payload);
    }
    context.showAlert(`Success! Created ${data.length} Payout Transfers in QBO.`, "success");
}
