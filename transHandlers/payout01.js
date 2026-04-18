import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js";
import { db } from '../auth.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { currentUser } from '../app.js';

export async function pushPayouts(data, config, context) {
    const pushQboEntity = httpsCallable(config.functions, 'pushQboEntity');

    let pushedIds = [];
    let rejected = [];

    for (const t of data) {
        if (!t.category) throw new Error("Missing category mapping in Payouts.");
        
        const vendorName = `${t.marketplace || 'Amazon'} Vendor`;
        const txnDate = t['date/time'] ? new Date(t['date/time']).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
        
        const amt = Math.abs(parseFloat(t.total || 0));

        // 1. Duplicate Check (Payouts are single lines, not grouped by Order ID)
        const signature = `PAYOUT_${txnDate}_${t['settlement id']}_${amt.toFixed(2)}`;
        const ledgerRef = doc(db, "users", currentUser.uid, "qbo_sync_ledger", signature);
        const ledgerSnap = await getDoc(ledgerRef);
        
        if (ledgerSnap.exists()) {
            rejected.push(t);
            continue; 
        }

        // 2. Build Payload
        const payload = {
            "entityType": "Purchase",
            "realmId": config.realmId,
            "data": {
                "TxnDate": txnDate,
                "PaymentType": "Cash",
                "AccountRef": { "name": config.depositAccountName }, 
                "EntityRef": { "name": vendorName },
                "PrivateNote": `Transfer ID: ${t['settlement id'] || 'N/A'}`,
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

        // 3. Push and Log
        const res = await pushQboEntity(payload);
        await setDoc(ledgerRef, { batchId: config.batchId, qboId: res.data.qboResponseId, timestamp: new Date().toISOString() });
        pushedIds.push({ type: "Purchase", id: res.data.qboResponseId });
    }

    if (rejected.length > 0) context.showRejectionModal(rejected);
    return pushedIds;
}
