import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js";

export async function pushDeposits(data, config, context) {
    const pushQboEntity = httpsCallable(config.functions, 'pushQboEntity');

    for (const t of data) {
        if (!t.category) throw new Error("Missing category mapping in Deposits.");
        
        const customerName = `${t.marketplace || 'Amazon'} Customer`;
        const txnDate = t['date/time'] ? new Date(t['date/time']).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

        const payload = {
            "entityType": "Deposit",
            "realmId": config.realmId,
            "data": {
                "TxnDate": txnDate,
                "DepositToAccountRef": { "name": config.depositAccountName },
                "PrivateNote": t.lineItem,
                "Line": [
                    {
                        "Amount": Math.abs(parseFloat(t.total)),
                        "DetailType": "DepositLineDetail",
                        "DepositLineDetail": {
                            "AccountRef": { "name": t.category },
                            "Entity": { "Type": "Customer", "EntityRef": { "name": customerName } }
                        },
                        "Description": t.lineItem
                    }
                ]
            }
        };

        await pushQboEntity(payload);
    }
    context.showAlert(`Success! Created ${data.length} Deposits in QBO.`, "success");
}
